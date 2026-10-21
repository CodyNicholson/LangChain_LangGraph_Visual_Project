"""Demo registry, execution context, graph extraction and the tracer that feeds the UI animations."""

from __future__ import annotations

import inspect
import textwrap
import threading
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.documents import Document
from langchain_core.messages import BaseMessage
from pydantic import BaseModel

from . import llm


# ---- Serialising arbitrary LangChain values for the UI -----------------------------------

def summarize(value: Any, depth: int = 0, max_str: int = 600) -> Any:
    if depth > 5:
        return "…"
    if isinstance(value, BaseMessage):
        out: dict[str, Any] = {"type": value.type, "content": summarize(value.content, depth + 1, max_str)}
        if getattr(value, "name", None):
            out["name"] = value.name
        if getattr(value, "tool_calls", None):
            out["tool_calls"] = [{"name": c["name"], "args": summarize(c["args"], depth + 1)} for c in value.tool_calls]
        if getattr(value, "tool_call_id", None):
            out["tool_call_id"] = value.tool_call_id
        return out
    if isinstance(value, Document):
        return {"type": "document", "page_content": summarize(value.page_content, depth + 1, max_str), "metadata": summarize(value.metadata, depth + 1)}
    if isinstance(value, BaseModel):
        return summarize(value.model_dump(), depth + 1, max_str)
    if isinstance(value, dict):
        items = list(value.items())
        out = {str(k): summarize(v, depth + 1, max_str) for k, v in items[:24]}
        if len(items) > 24:
            out["…"] = f"{len(items) - 24} more keys"
        return out
    if isinstance(value, (list, tuple, set)):
        items = list(value)
        out_list = [summarize(v, depth + 1, max_str) for v in items[:12]]
        if len(items) > 12:
            out_list.append(f"… {len(items) - 12} more")
        return out_list
    if isinstance(value, str):
        return value if len(value) <= max_str else value[:max_str] + "…"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if hasattr(value, "to_messages"):
        return summarize(value.to_messages(), depth + 1, max_str)
    text = repr(value)
    return text if len(text) <= max_str else text[:max_str] + "…"


# ---- Graph extraction ----------------------------------------------------------------------

def graph_of(runnable: Any, xray: bool | int = False) -> dict[str, Any]:
    """Nodes and edges from LangChain's own Runnable.get_graph() (LCEL chains and LangGraph graphs)."""
    graph = runnable.get_graph(xray=xray) if xray else runnable.get_graph()
    nodes = []
    for node_id, node in graph.nodes.items():
        label = node.name if isinstance(node.name, str) else str(node_id)
        nodes.append({"id": str(node_id), "label": label})
    edges = [
        {"source": str(e.source), "target": str(e.target), "conditional": bool(e.conditional), "label": str(e.data) if e.data else None}
        for e in graph.edges
    ]
    return {"nodes": nodes, "edges": edges, "mermaid": graph.draw_mermaid()}


def manual_graph(nodes: list[str], edges: list[tuple], labels: dict[str, str] | None = None, kinds: dict[str, str] | None = None) -> dict[str, Any]:
    """For flows that are plain Python (e.g. a hand-written tool loop) rather than one Runnable.

    `kinds` maps a node to a trace kind (llm, tool, retriever, ...) so the UI lights it up
    whenever a run of that kind happens.
    """
    labels = labels or {}
    kinds = kinds or {}
    out_edges = []
    for edge in edges:
        source, target, *rest = edge
        out_edges.append({"source": source, "target": target, "conditional": bool(rest and rest[0]), "label": rest[1] if len(rest) > 1 else None})
    mermaid = "graph TD;\n" + "\n".join(
        f"\t{e['source']} {'-.->' if e['conditional'] else '-->'} {e['target']};" for e in out_edges
    )
    return {"nodes": [{"id": n, "label": labels.get(n, n), "kind": kinds.get(n)} for n in nodes], "edges": out_edges, "mermaid": mermaid}


# ---- Tracer --------------------------------------------------------------------------------

SKIP_NAMES = {"RunnableSequence", "RunnableLambda", "RunnableParallel", "RunnableAssign", "RunnablePassthrough", "LangGraph", "_write", "ChannelWrite", "_route", "RunnableCallable"}


class Tracer(BaseCallbackHandler):
    """Collects LangChain callback events (chains, models, tools, retrievers, parsers) with timings."""

    raise_error = False

    def __init__(self) -> None:
        self.t0 = time.perf_counter()
        self.runs: dict[UUID, dict[str, Any]] = {}
        self.order: list[UUID] = []
        self.lock = threading.Lock()
        self.tokens = 0

    def _now(self) -> float:
        return round((time.perf_counter() - self.t0) * 1000, 1)

    def _start(self, run_id: UUID, parent: UUID | None, kind: str, name: str, inputs: Any, metadata: dict | None, tags: list | None) -> None:
        with self.lock:
            self.runs[run_id] = {
                "id": str(run_id), "parent": str(parent) if parent else None, "kind": kind, "name": name,
                "input": summarize(inputs, max_str=300), "startMs": self._now(), "node": (metadata or {}).get("langgraph_node"),
                "step": (metadata or {}).get("langgraph_step"), "tags": [t for t in (tags or []) if not t.startswith("graph:step") and not t.startswith("seq:")],
            }
            self.order.append(run_id)

    def _end(self, run_id: UUID, output: Any, error: BaseException | None = None) -> None:
        with self.lock:
            run = self.runs.get(run_id)
            if not run:
                return
            run["endMs"] = self._now()
            run["durationMs"] = round(run["endMs"] - run["startMs"], 1)
            if error is not None:
                run["error"] = f"{type(error).__name__}: {error}"[:300]
            else:
                run["output"] = summarize(output, max_str=300)

    @staticmethod
    def _name(serialized: dict | None, kwargs: dict) -> str:
        if kwargs.get("name"):
            return kwargs["name"]
        if serialized:
            if serialized.get("name"):
                return serialized["name"]
            if serialized.get("id"):
                return serialized["id"][-1]
        return "?"

    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs):
        name = self._name(serialized, kwargs)
        kind = "parser" if "Parser" in name else "prompt" if "Prompt" in name else "chain"
        self._start(run_id, parent_run_id, kind, name, inputs, metadata, tags)

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        self._end(run_id, outputs)

    def on_chain_error(self, error, *, run_id, **kwargs):
        # GraphInterrupt is how LangGraph pauses for a human: record it as an interrupt, not a failure.
        if type(error).__name__ in ("GraphInterrupt", "ParentCommand"):
            self._end(run_id, {"interrupted": True})
            return
        self._end(run_id, None, error)

    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs):
        self._start(run_id, parent_run_id, "llm", self._name(serialized, kwargs), messages[0] if messages else [], metadata, tags)

    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs):
        self._start(run_id, parent_run_id, "llm", self._name(serialized, kwargs), prompts, metadata, tags)

    def on_llm_new_token(self, token, **kwargs):
        self.tokens += 1

    def on_llm_end(self, response, *, run_id, **kwargs):
        gen = response.generations[0][0] if response.generations and response.generations[0] else None
        self._end(run_id, getattr(gen, "message", None) or getattr(gen, "text", None))

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._end(run_id, None, error)

    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, tags=None, metadata=None, inputs=None, **kwargs):
        self._start(run_id, parent_run_id, "tool", self._name(serialized, kwargs), inputs or input_str, metadata, tags)

    def on_tool_end(self, output, *, run_id, **kwargs):
        self._end(run_id, output)

    def on_tool_error(self, error, *, run_id, **kwargs):
        self._end(run_id, None, error)

    def on_retriever_start(self, serialized, query, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs):
        self._start(run_id, parent_run_id, "retriever", self._name(serialized, kwargs), query, metadata, tags)

    def on_retriever_end(self, documents, *, run_id, **kwargs):
        self._end(run_id, documents)

    def on_retriever_error(self, error, *, run_id, **kwargs):
        self._end(run_id, None, error)

    def steps(self, graph_labels: set[str]) -> list[dict[str, Any]]:
        """Runs worth animating: models, tools, retrievers, and chains that are nodes of the drawn graph."""
        out = []
        with self.lock:
            runs = [self.runs[r] for r in self.order]
        roots = {r["id"] for r in runs if r["parent"] is None}
        for run in runs:
            keep = run["kind"] in ("llm", "tool", "retriever")
            if run["kind"] in ("chain", "parser", "prompt"):
                keep = run["name"] in graph_labels and run["name"] not in SKIP_NAMES and not (run["id"] in roots and run["kind"] == "chain")
                if run["node"] and run["name"] != run["node"] and run["kind"] == "chain":
                    keep = False
            if keep:
                out.append(run)
        return out


# ---- Demo context & registry ------------------------------------------------------------------

@dataclass
class Ctx:
    mode: str  # "mock" or "live"
    inputs: dict[str, Any]
    tracer: Tracer = field(default_factory=Tracer)
    checks: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    graph: dict[str, Any] | None = None
    sink: Callable[[dict[str, Any]], None] | None = None  # set when the run is streamed over SSE

    @property
    def live(self) -> bool:
        return self.mode == "live"

    @property
    def config(self) -> dict[str, Any]:
        return {"callbacks": [self.tracer]}

    def model(self, script: llm.Script | None = None, mock_latency: float | None = None, **kwargs: Any):
        """ChatAnthropic in live mode; a ScriptedChatModel following `script` in mock mode."""
        return llm.make_model(self.mode, script, mock_latency, **kwargs)

    def draw(self, runnable: Any, xray: bool | int = False) -> None:
        self.graph = graph_of(runnable, xray)

    def draw_manual(self, nodes: list[str], edges: list[tuple], labels: dict[str, str] | None = None, kinds: dict[str, str] | None = None) -> None:
        self.graph = manual_graph(nodes, edges, labels, kinds)

    def check(self, label: str, ok: Any, detail: Any = None) -> bool:
        self.checks.append({"label": label, "ok": bool(ok), "detail": summarize(detail) if detail is not None else None})
        return bool(ok)

    def event(self, label: str, data: Any = None, node: str | None = None) -> None:
        """A custom timeline event (e.g. one stream chunk, one checkpoint)."""
        item = {"t": self.tracer._now(), "label": label, "node": node, "data": summarize(data)}
        self.events.append(item)
        if self.sink:
            self.sink({"type": "event", **item})

    def text(self, key: str, default: str = "") -> str:
        value = self.inputs.get(key, default)
        return str(value if value not in (None, "") else default).strip()[:2000]

    def int(self, key: str, default: int, lo: int, hi: int) -> int:
        try:
            value = int(float(self.inputs.get(key, default)))
        except (TypeError, ValueError):
            value = default
        return max(lo, min(hi, value))


@dataclass
class Demo:
    id: str
    library: str
    title: str
    fn: Callable[[Ctx], Any]
    stateful: bool = False

    @property
    def source(self) -> str:
        return textwrap.dedent(inspect.getsource(self.fn))


REGISTRY: dict[str, Demo] = {}


def demo(id: str, library: str, title: str, stateful: bool = False):
    def register(fn: Callable[[Ctx], Any]):
        REGISTRY[id] = Demo(id=id, library=library, title=title, fn=fn, stateful=stateful)
        return fn
    return register


def run_demo(demo_id: str, inputs: dict[str, Any], mode: str, sink: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    entry = REGISTRY[demo_id]
    ctx = Ctx(mode=mode, inputs=inputs or {}, sink=sink)
    started = time.perf_counter()
    error = None
    output: Any = None
    try:
        output = entry.fn(ctx)
    except Exception as exc:  # surfaced to the UI rather than as a 500
        error = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
    labels = {n["label"] for n in (ctx.graph or {}).get("nodes", [])}
    return {
        "id": demo_id,
        "mode": mode,
        "model": llm.model_name() if mode == "live" else "scripted-mock",
        "output": output,
        "graph": ctx.graph,
        "trace": ctx.tracer.steps(labels),
        "events": ctx.events,
        "checks": ctx.checks,
        "notes": ctx.notes,
        "error": error,
        "elapsedMs": round((time.perf_counter() - started) * 1000, 1),
    }
