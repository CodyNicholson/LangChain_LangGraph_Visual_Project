"""FastAPI service behind nginx: lists the demos (source + graph) and runs them, as JSON or over SSE."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from . import demos  # noqa: F401  (registers every demo)
from . import llm
from .core import REGISTRY, run_demo

log = logging.getLogger("langlab")

# Inputs that let a warm-up run draw a stateful demo's graph without touching real sessions.
WARMUP_INPUTS = {
    "lc-memory": {"action": "clear", "session": "__warmup__"},
    "lg-checkpoint": {"thread": "__warmup__"},
    "lg-store": {"user_id": "__warmup__", "message": "what do I like?"},
}
_graphs: dict[str, Any] = {}
_warm = threading.Event()


def warm_up() -> None:
    """Run every demo once offline so the UI can draw each graph before the first click."""
    def one(demo_id: str):
        result = run_demo(demo_id, WARMUP_INPUTS.get(demo_id, {}), "mock")
        _graphs[demo_id] = result["graph"]
        if result["error"] or not all(c["ok"] for c in result["checks"]):
            log.warning("warm-up: %s error=%s checks=%s", demo_id, result["error"], result["checks"])

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(one, REGISTRY))
    _warm.set()
    log.warning("warm-up: %d demos ready in %.1fs (live mode %s)", len(REGISTRY), time.perf_counter() - started,
                "available" if llm.live_available() else "off: no ANTHROPIC_API_KEY")


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=warm_up, daemon=True).start()
    yield


app = FastAPI(title="LangChain & LangGraph Visual Lab", lifespan=lifespan)


# ---- Live-mode guard: the site is public, the API key is not ------------------------------------

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


class LiveLimiter:
    """Sliding-window limits on live (paid) model runs: per client per minute and globally per hour."""

    def __init__(self) -> None:
        self.per_client: dict[str, deque[float]] = defaultdict(deque)
        self.global_runs: deque[float] = deque()
        self.lock = threading.Lock()

    def allow(self, client: str) -> tuple[bool, str]:
        per_minute, per_hour = _env_int("LIVE_RUNS_PER_MINUTE", 6), _env_int("LIVE_RUNS_PER_HOUR", 120)
        now = time.monotonic()
        with self.lock:
            mine = self.per_client[client]
            while mine and now - mine[0] > 60:
                mine.popleft()
            while self.global_runs and now - self.global_runs[0] > 3600:
                self.global_runs.popleft()
            if len(mine) >= per_minute:
                return False, f"Live mode is limited to {per_minute} runs per minute. Try again shortly or switch to the offline model."
            if len(self.global_runs) >= per_hour:
                return False, "The hourly live-mode budget for this site is used up. The offline model still works."
            mine.append(now)
            self.global_runs.append(now)
            if len(self.per_client) > 5000:
                self.per_client.clear()
            return True, ""


limiter = LiveLimiter()


def live_enabled() -> bool:
    return llm.live_available() and os.getenv("ALLOW_LIVE_MODE", "true").lower() == "true"


def client_id(request: Request) -> str:
    return (request.headers.get("cf-connecting-ip") or request.headers.get("x-real-ip")
            or (request.client.host if request.client else "unknown"))


def resolve_mode(live: bool, request: Request) -> str:
    if not live:
        return "mock"
    if not live_enabled():
        raise HTTPException(400, "Live mode is off: set ANTHROPIC_API_KEY in .env (and ALLOW_LIVE_MODE=true).")
    ok, reason = limiter.allow(client_id(request))
    if not ok:
        raise HTTPException(429, reason)
    return "live"


# ---- Routes ----------------------------------------------------------------------------------------

def _version(pkg: str) -> str | None:
    try:
        return version(pkg)
    except PackageNotFoundError:
        return None


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "demos": len(REGISTRY), "warm": _warm.is_set()}


@app.get("/api/config")
def config() -> dict[str, Any]:
    return {
        "liveAvailable": live_enabled(),
        "model": llm.model_name(),
        "langsmith": os.getenv("LANGSMITH_TRACING", "false").lower() == "true" and bool(os.getenv("LANGSMITH_API_KEY")),
        "limits": {"perMinute": _env_int("LIVE_RUNS_PER_MINUTE", 6), "perHour": _env_int("LIVE_RUNS_PER_HOUR", 120)},
        "versions": {p: _version(p) for p in ("langchain", "langchain-core", "langgraph", "langchain-anthropic", "langchain-text-splitters")},
    }


@app.get("/api/demos")
async def list_demos() -> list[dict[str, Any]]:
    await run_in_threadpool(_warm.wait, 60)
    return [{"id": d.id, "library": d.library, "title": d.title, "stateful": d.stateful, "source": d.source, "graph": _graphs.get(d.id)}
            for d in REGISTRY.values()]


class RunRequest(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)
    live: bool = False


def _get(demo_id: str):
    if demo_id not in REGISTRY:
        raise HTTPException(404, f"Unknown demo '{demo_id}'")
    return REGISTRY[demo_id]


@app.post("/api/demos/{demo_id}/run")
async def run(demo_id: str, body: RunRequest, request: Request) -> dict[str, Any]:
    _get(demo_id)
    mode = resolve_mode(body.live, request)
    return await run_in_threadpool(run_demo, demo_id, body.inputs, mode)


@app.get("/api/demos/{demo_id}/stream")
async def stream(demo_id: str, request: Request, inputs: str = Query("{}"), live: bool = False):
    """Server-Sent Events: each ctx.event() as it happens (e.g. tokens), then the full result."""
    _get(demo_id)
    try:
        parsed = json.loads(inputs)
        assert isinstance(parsed, dict)
    except (ValueError, AssertionError):
        raise HTTPException(400, "inputs must be a JSON object")
    mode = resolve_mode(live, request)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def sink(item: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, item)

    def work() -> None:
        result = run_demo(demo_id, parsed, mode, sink=sink)
        sink({"type": "result", "result": result})

    loop.run_in_executor(None, work)

    async def events():
        while True:
            item = await queue.get()
            yield {"event": item["type"], "data": json.dumps(item, default=str)}
            if item["type"] == "result":
                break

    return EventSourceResponse(events(), ping=15)
