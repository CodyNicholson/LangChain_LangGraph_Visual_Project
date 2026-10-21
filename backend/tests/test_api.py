"""HTTP layer: config, catalog, runs, SSE streaming and the live-mode guard."""

import json

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def test_health_and_config(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert client.get("/api/health").json()["status"] == "ok"
    cfg = client.get("/api/config").json()
    assert cfg["liveAvailable"] is False
    assert cfg["versions"]["langgraph"] and cfg["versions"]["langchain"]


def test_catalog_has_source_and_graph(client):
    demos = client.get("/api/demos").json()
    assert len(demos) >= 28
    for d in demos:
        assert d["source"].lstrip().startswith("@demo(")
        assert d["graph"] and d["graph"]["nodes"], d["id"]


def test_run_endpoint(client):
    body = client.post("/api/demos/lc-lcel/run", json={"inputs": {"topic": "graphs"}}).json()
    assert body["mode"] == "mock" and body["error"] is None
    assert all(c["ok"] for c in body["checks"])


def test_unknown_demo_404(client):
    assert client.post("/api/demos/nope/run", json={}).status_code == 404


def test_live_mode_refused_without_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/api/demos/lc-models/run", json={"live": True})
    assert r.status_code == 400 and "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_live_limiter(monkeypatch):
    monkeypatch.setenv("LIVE_RUNS_PER_MINUTE", "2")
    monkeypatch.setenv("LIVE_RUNS_PER_HOUR", "3")
    limiter = main.LiveLimiter()
    assert limiter.allow("a")[0] and limiter.allow("a")[0]
    assert not limiter.allow("a")[0]           # per-client minute cap
    assert limiter.allow("b")[0]
    ok, reason = limiter.allow("c")            # global hourly cap
    assert not ok and "hourly" in reason


def test_sse_stream_emits_tokens_then_result(client):
    with client.stream("GET", "/api/demos/lc-streaming/stream", params={"inputs": json.dumps({"topic": "rivers"})}) as r:
        assert r.status_code == 200
        kinds = []
        for line in r.iter_lines():
            if line.startswith("event:"):
                kinds.append(line.split(":", 1)[1].strip())
    assert kinds.count("event") > 3 and kinds[-1] == "result"


def test_sse_rejects_bad_inputs(client):
    assert client.get("/api/demos/lc-streaming/stream", params={"inputs": "[1]"}).status_code == 400
