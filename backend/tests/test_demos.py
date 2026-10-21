"""Every demo must run offline (scripted model) and pass the self-checks it reports."""

import pytest

from app import demos  # noqa: F401
from app.core import REGISTRY, run_demo

STATEFUL_INPUTS = {
    "lc-memory": {"session": "pytest"},
    "lg-checkpoint": {"thread": "pytest"},
    "lg-store": {"user_id": "pytest"},
}


@pytest.mark.parametrize("demo_id", sorted(REGISTRY))
def test_demo_runs_and_checks_pass(demo_id):
    result = run_demo(demo_id, STATEFUL_INPUTS.get(demo_id, {}), "mock")
    assert result["error"] is None
    assert result["checks"], "every demo should verify something"
    failed = [c for c in result["checks"] if not c["ok"]]
    assert not failed, failed
    assert result["graph"] and result["graph"]["nodes"], "every demo draws a graph"
    assert result["output"]["kind"]


def test_registry_covers_both_libraries():
    libraries = {d.library for d in REGISTRY.values()}
    assert libraries == {"langchain", "langgraph"}
    assert len(REGISTRY) >= 28


def test_tool_loop_trace_has_model_and_tool_runs():
    trace = run_demo("lc-tools", {}, "mock")["trace"]
    kinds = [t["kind"] for t in trace]
    assert kinds[0] == "llm" and "tool" in kinds and kinds[-1] == "llm"


def test_langgraph_trace_is_tagged_with_graph_nodes():
    result = run_demo("lg-react", {}, "mock")
    node_ids = {n["id"] for n in result["graph"]["nodes"]}
    assert {"agent", "tools"} <= node_ids
    assert all(t["node"] in node_ids for t in result["trace"])


def test_memory_remembers_across_requests():
    run_demo("lc-memory", {"session": "pytest-name", "message": "Hi, my name is Grace."}, "mock")
    result = run_demo("lc-memory", {"session": "pytest-name", "message": "What is my name?"}, "mock")
    assert "Grace" in result["output"]["messages"][-1]["content"]
    cleared = run_demo("lc-memory", {"session": "pytest-name", "action": "clear"}, "mock")
    assert cleared["output"]["messages"] == []


def test_checkpoint_threads_are_isolated():
    run_demo("lg-checkpoint", {"thread": "pytest-a", "message": "one"}, "mock")
    a = run_demo("lg-checkpoint", {"thread": "pytest-a", "message": "two"}, "mock")
    b = run_demo("lg-checkpoint", {"thread": "pytest-b", "message": "one"}, "mock")
    assert len(a["output"]["messages"]) == 4
    assert len(b["output"]["messages"]) == 2


@pytest.mark.parametrize("decision,expected", [("approve", "Refunded $120.00"), ("edit", "Refunded $80.00"), ("reject", "rejected")])
def test_human_in_the_loop_resume(decision, expected):
    started = run_demo("lg-hitl", {"action": "start"}, "mock")
    out = started["output"]
    assert out["status"] == "interrupted" and out["interrupt"]["amount"] == 120.0
    resumed = run_demo("lg-hitl", {"action": "resume", "thread_id": out["thread_id"], "decision": decision, "amount": 80 if decision == "edit" else None}, "mock")
    assert resumed["output"]["status"] == "done"
    assert expected in resumed["output"]["state"]["result"]


def test_store_recalls_from_another_thread():
    run_demo("lg-store", {"user_id": "pytest-user", "thread": "t1", "message": "Remember that my favourite city is Lisbon"}, "mock")
    result = run_demo("lg-store", {"user_id": "pytest-user", "thread": "t2", "message": "Which city is my favourite?"}, "mock")
    assert "Lisbon" in result["output"]["reply"]


def test_routing_follows_input():
    tech = run_demo("lg-conditional", {"question": "The API returns an error on login"}, "mock")
    assert tech["output"]["final"]["category"] == "technical"
    handoff = run_demo("lg-command", {"message": "I need a refund"}, "mock")
    assert handoff["output"]["final"]["path"][0] == "triage → billing_agent"


def test_splitter_respects_chunk_size():
    result = run_demo("lc-splitters", {"chunk_size": 120, "chunk_overlap": 20, "splitter": "recursive"}, "mock")
    assert all(len(c["text"]) <= 120 for c in result["output"]["chunks"])
    md = run_demo("lc-splitters", {"splitter": "markdown"}, "mock")
    assert all("section" in c["metadata"] or "title" in c["metadata"] for c in md["output"]["chunks"])
