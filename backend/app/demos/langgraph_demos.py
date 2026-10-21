"""LangGraph feature demos. Each function is shown verbatim in the UI as "the code that ran"."""

import operator
import re
import time
import uuid
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.cache.memory import InMemoryCache
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.config import get_stream_writer
from langgraph.func import entrypoint, task
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.runtime import Runtime
from langgraph.store.memory import InMemoryStore
from langgraph.types import CachePolicy, Command, RetryPolicy, Send, interrupt
from pydantic import BaseModel, Field

from ..core import Ctx, demo, summarize
from ..llm import HashingEmbeddings, last_text, tool_call
from .shared import TOOLS, agent_script

LG = "langgraph"


def _record(ctx: Ctx, stream) -> dict:
    """Consume a stream(stream_mode=["updates", "values"]) into timeline events; return the final state."""
    final: dict = {}
    for mode, chunk in stream:
        if mode == "updates":
            for node, update in chunk.items():
                ctx.event(node, update, node=node)
        elif mode == "values":
            final = chunk
    return final


# ---- Scripts for the offline model ---------------------------------------------------------------

def _classify_script(messages, ctx):
    text = last_text(messages).lower()
    if any(w in text for w in ("refund", "charge", "invoice", "price", "bill", "pay")):
        return "billing"
    if any(w in text for w in ("error", "crash", "bug", "install", "api", "login", "slow")):
        return "technical"
    return "general"


def _reply_script(messages, ctx):
    system = next((str(m.content) for m in messages if m.type == "system"), "")
    team = re.search(r"You are the (\w+)", system)
    return f"[{team.group(1) if team else 'assistant'} team] Thanks for reaching out about \"{last_text(messages)[:80]}\". Here's how we'll help next."


def _writer_script(messages, ctx):
    prompt = last_text(messages)
    n = len(re.findall(r"Feedback:", prompt)) + 1
    topic = re.search(r"about (.+?)\.", prompt)
    return f"Draft v{n}: a {['rough', 'clearer', 'vivid', 'polished', 'excellent'][min(n - 1, 4)]} tagline about {topic.group(1) if topic else 'the topic'}."


def _critic_script(messages, ctx):
    draft = last_text(messages)
    n = int(re.search(r"Draft v(\d+)", draft).group(1)) if re.search(r"Draft v(\d+)", draft) else 1
    score = min(10, 3 + 2 * n)
    return AIMessage(content="", tool_calls=[tool_call(ctx["tools"][0], {"score": score, "feedback": "Make it punchier." if score < 9 else "Great."})])


def _fact_script(messages, ctx):
    topic = last_text(messages).split(":")[-1].strip().rstrip(".")
    return f"{topic.title()}: a surprising fact #{abs(hash(topic)) % 97}."


def _chat_script(messages, ctx):
    turns = sum(1 for m in messages if m.type == "human")
    return f"Reply #{turns} on this thread — I remember all {len(messages) - 1} earlier messages."


def _store_script(messages, ctx):
    system = next((str(m.content) for m in messages if m.type == "system"), "")
    memories = re.findall(r"- (.+)", system)
    question = last_text(messages)
    if memories:
        return f"From your long-term memory: {memories[0]}"
    return f"I don't have any memories about that yet. (You asked: {question[:80]})"


# ---- Demos ---------------------------------------------------------------------------------------

@demo("lg-basics", LG, "StateGraph basics")
def state_graph_basics(ctx: Ctx):
    class State(TypedDict):                 # the shared state every node reads and updates
        text: str
        words: int
        shout: str
        report: str

    def count_words(state: State) -> dict:
        return {"words": len(state["text"].split())}      # return only the keys you change

    def shout(state: State) -> dict:
        return {"shout": state["text"].upper() + "!"}

    def report(state: State) -> dict:
        return {"report": f"{state['words']} words → {state['shout']}"}

    builder = StateGraph(State)
    builder.add_node("count_words", count_words)
    builder.add_node("shout", shout)
    builder.add_node("report", report)
    builder.add_edge(START, "count_words")
    builder.add_edge("count_words", "shout")
    builder.add_edge("shout", "report")
    builder.add_edge("report", END)
    graph = builder.compile()

    final = _record(ctx, graph.stream({"text": ctx.text("text", "graphs are just functions and edges")},
                                      config=ctx.config, stream_mode=["updates", "values"]))
    ctx.draw(graph)
    ctx.check("Every node ran once, in order", [e["node"] for e in ctx.events] == ["count_words", "shout", "report"])
    ctx.check("Final state merged all node updates", {"words", "shout", "report"} <= set(final))
    return {"kind": "state", "final": final}


@demo("lg-reducers", LG, "State reducers")
def reducers(ctx: Ctx):
    class State(TypedDict):
        log: Annotated[list[str], operator.add]       # reducer: append instead of overwrite
        total: Annotated[int, operator.add]           # reducer: sum parallel writes
        messages: Annotated[list, add_messages]       # append, but replace a message with the same id
        winner: str                                   # no reducer: last write wins

    def worker_a(state: State):
        return {"log": ["A ran"], "total": 10, "messages": [AIMessage("draft from A", id="draft")]}

    def worker_b(state: State):
        return {"log": ["B ran"], "total": 5}

    def join(state: State):
        return {"log": ["join ran"], "winner": "join", "messages": [AIMessage("edited draft (same id, replaced)", id="draft")]}

    builder = StateGraph(State)
    builder.add_node("worker_a", worker_a).add_node("worker_b", worker_b).add_node("join", join)
    builder.add_edge(START, "worker_a").add_edge(START, "worker_b")      # fan out: both run in one super-step
    builder.add_edge(["worker_a", "worker_b"], "join").add_edge("join", END)  # join waits for both
    graph = builder.compile()

    start = ctx.int("start_total", 1, -100, 100)
    final = _record(ctx, graph.stream({"log": ["start"], "total": start, "messages": [HumanMessage("hi", id="h1")], "winner": "input"},
                                      config=ctx.config, stream_mode=["updates", "values"]))
    ctx.draw(graph)
    ctx.check("operator.add appended every log entry", sorted(final["log"]) == sorted(["start", "A ran", "B ran", "join ran"]), final["log"])
    ctx.check("Parallel ints were summed", final["total"] == start + 15, final["total"])
    ctx.check("add_messages replaced the message with the same id", len(final["messages"]) == 2 and "edited" in final["messages"][1].content)
    ctx.check("Plain key: last write wins", final["winner"] == "join")
    return {"kind": "state", "final": summarize(final)}


@demo("lg-conditional", LG, "Conditional edges (routing)")
def conditional_edges(ctx: Ctx):
    class State(TypedDict):
        question: str
        category: str
        answer: str

    router_model = ctx.model(script=_classify_script)
    reply_model = ctx.model(script=_reply_script)

    def classify(state: State):
        label = router_model.invoke([SystemMessage("Classify the message as exactly one word: billing, technical or general."),
                                     HumanMessage(state["question"])]).text.strip().lower()
        return {"category": label if label in ("billing", "technical", "general") else "general"}

    def make_team(team: str):
        def respond(state: State):
            return {"answer": reply_model.invoke([SystemMessage(f"You are the {team} support team. Reply in one sentence."),
                                                  HumanMessage(state["question"])]).text}
        return respond

    def route(state: State) -> Literal["billing", "technical", "general"]:
        return state["category"]                      # the returned value picks the next node

    builder = StateGraph(State)
    builder.add_node("classify", classify)
    for team in ("billing", "technical", "general"):
        builder.add_node(team, make_team(team))
        builder.add_edge(team, END)
    builder.add_edge(START, "classify")
    builder.add_conditional_edges("classify", route)
    graph = builder.compile()

    final = _record(ctx, graph.stream({"question": ctx.text("question", "I was charged twice, can I get a refund?")},
                                      config=ctx.config, stream_mode=["updates", "values"]))
    ctx.draw(graph)
    ctx.check("Exactly one branch ran", len([e for e in ctx.events if e["node"] in ("billing", "technical", "general")]) == 1)
    ctx.check("The branch matches the category", any(e["node"] == final["category"] for e in ctx.events), final["category"])
    return {"kind": "state", "final": final}


class Review(BaseModel):
    """A critic's review of a draft."""
    score: int = Field(ge=1, le=10, description="Quality from 1 to 10")
    feedback: str = Field(description="One short suggestion")


@demo("lg-loops", LG, "Cycles & loops")
def loops(ctx: Ctx):
    class State(TypedDict):
        topic: str
        draft: str
        score: int
        iterations: int
        feedback: Annotated[list[str], operator.add]

    writer = ctx.model(script=_writer_script)
    critic = ctx.model(script=_critic_script).with_structured_output(Review)
    threshold, max_iterations = ctx.int("threshold", 8, 1, 10), ctx.int("max_iterations", 4, 1, 6)

    def write(state: State):
        notes = "".join(f"\nFeedback: {f}" for f in state["feedback"])
        draft = writer.invoke(f"Write a one-line tagline about {state['topic']}.{notes}").text
        return {"draft": draft, "iterations": state["iterations"] + 1}

    def review(state: State):
        result = critic.invoke(f"Score this tagline from 1-10 and give one suggestion:\n{state['draft']}")
        return {"score": result.score, "feedback": [result.feedback]}

    def good_enough(state: State) -> Literal["write", "__end__"]:
        if state["score"] >= threshold or state["iterations"] >= max_iterations:
            return END
        return "write"                                 # loop back: graphs may contain cycles

    builder = StateGraph(State)
    builder.add_node("write", write).add_node("review", review)
    builder.add_edge(START, "write").add_edge("write", "review")
    builder.add_conditional_edges("review", good_enough)
    graph = builder.compile()

    final = _record(ctx, graph.stream({"topic": ctx.text("topic", "a coffee shop on Mars"), "iterations": 0, "feedback": [], "score": 0, "draft": ""},
                                      config={**ctx.config, "recursion_limit": 25}, stream_mode=["updates", "values"]))
    ctx.draw(graph)
    ctx.check("Looped more than once" if threshold > 5 else "Stopped early", final["iterations"] > 1 or threshold <= 5, final["iterations"])
    ctx.check("Stopped on score or iteration cap", final["score"] >= threshold or final["iterations"] >= max_iterations)
    return {"kind": "state", "final": final}


@demo("lg-react", LG, "Tool-calling agent from scratch")
def react_agent(ctx: Ctx):
    model = ctx.model(script=agent_script).bind_tools(TOOLS)

    def call_model(state: MessagesState):
        return {"messages": [model.invoke(state["messages"])]}

    builder = StateGraph(MessagesState)                # state = {"messages": [...]} with add_messages
    builder.add_node("agent", call_model)
    builder.add_node("tools", ToolNode(TOOLS))         # runs every tool call in the last AIMessage
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", tools_condition)  # tool calls? -> "tools", else END
    builder.add_edge("tools", "agent")                 # results go back to the model
    graph = builder.compile()

    final = _record(ctx, graph.stream({"messages": [HumanMessage(ctx.text("question", "What's the weather in Denver and what is (12 + 30) * 2?"))]},
                                      config=ctx.config, stream_mode=["updates", "values"]))
    ctx.draw(graph)
    visited = [e["node"] for e in ctx.events]
    ctx.check("agent → tools → agent loop happened", visited[:3] == ["agent", "tools", "agent"], visited)
    ctx.check("Ended on an answer without tool calls", not final["messages"][-1].tool_calls)
    return {"kind": "messages", "messages": summarize(final["messages"])}


_CHECKPOINTS = InMemorySaver()


@demo("lg-checkpoint", LG, "Persistence & threads", stateful=True)
def persistence(ctx: Ctx):
    model = ctx.model(script=_chat_script)

    def chat(state: MessagesState):
        return {"messages": [model.invoke(state["messages"])]}

    graph = (StateGraph(MessagesState).add_node("chat", chat).add_edge(START, "chat").add_edge("chat", END)
             .compile(checkpointer=_CHECKPOINTS))      # state is saved after every step
    config = {**ctx.config, "configurable": {"thread_id": f"lg-checkpoint:{ctx.text('thread', 'thread-1')[:40]}"}}

    graph.invoke({"messages": [HumanMessage(ctx.text("message", "Hello there!"))]}, config=config)
    snapshot = graph.get_state(config)                 # latest checkpoint for this thread
    history = list(graph.get_state_history(config))    # every checkpoint, newest first

    ctx.draw(graph)
    ctx.check("Thread kept its earlier messages", len(snapshot.values["messages"]) >= 2, len(snapshot.values["messages"]))
    ctx.check("A checkpoint exists for every step", len(history) >= 3, len(history))
    return {"kind": "checkpoints", "messages": summarize(snapshot.values["messages"]), "thread": ctx.text("thread", "thread-1"),
            "checkpoints": [{"id": h.config["configurable"]["checkpoint_id"], "step": h.metadata.get("step"), "source": h.metadata.get("source"),
                             "next": list(h.next), "messages": len(h.values.get("messages", [])), "created_at": h.created_at} for h in history[:12]]}


_HITL = InMemorySaver()


@demo("lg-hitl", LG, "Human-in-the-loop (interrupt)", stateful=True)
def human_in_the_loop(ctx: Ctx):
    class State(TypedDict):
        request: str
        amount: float
        decision: str
        result: str

    def plan_refund(state: State):
        found = re.search(r"\$?(\d+(?:\.\d+)?)", state["request"])
        return {"amount": float(found.group(1)) if found else 50.0}

    def human_review(state: State):
        answer = interrupt({"question": "Approve this refund?", "amount": state["amount"], "request": state["request"]})
        return {"decision": answer["action"], "amount": float(answer.get("amount") or state["amount"])}  # resumes here

    def issue_refund(state: State):
        return {"result": f"Refunded ${state['amount']:.2f}"}

    def notify_rejected(state: State):
        return {"result": "Refund rejected; customer notified"}

    def after_review(state: State) -> Literal["issue_refund", "notify_rejected"]:
        return "issue_refund" if state["decision"] in ("approve", "edit") else "notify_rejected"

    builder = StateGraph(State)
    for name, fn in [("plan_refund", plan_refund), ("human_review", human_review), ("issue_refund", issue_refund), ("notify_rejected", notify_rejected)]:
        builder.add_node(name, fn)
    builder.add_edge(START, "plan_refund").add_edge("plan_refund", "human_review")
    builder.add_conditional_edges("human_review", after_review)
    builder.add_edge("issue_refund", END).add_edge("notify_rejected", END)
    graph = builder.compile(checkpointer=_HITL)        # interrupts need a checkpointer to resume from

    if ctx.text("action", "start") == "start":
        thread_id = f"refund-{uuid.uuid4().hex[:8]}"
        payload = {"request": ctx.text("request", "Customer asks for a $120 refund for a broken grinder.")}
    else:
        thread_id = ctx.text("thread_id")
        payload = Command(resume={"action": ctx.text("decision", "approve"), "amount": ctx.inputs.get("amount")})
    config = {**ctx.config, "configurable": {"thread_id": thread_id}}

    final = _record(ctx, graph.stream(payload, config=config, stream_mode=["updates", "values"]))
    snapshot = graph.get_state(config)
    ctx.draw(graph)
    if snapshot.interrupts:
        ctx.check("Graph paused inside human_review", snapshot.next == ("human_review",))
        ctx.check("Interrupt payload reached the caller", snapshot.interrupts[0].value["amount"] > 0)
    else:
        ctx.check("Graph resumed and finished", not snapshot.next and bool(final.get("result")), final.get("result"))
    return {"kind": "hitl", "thread_id": thread_id, "status": "interrupted" if snapshot.interrupts else "done",
            "interrupt": snapshot.interrupts[0].value if snapshot.interrupts else None, "state": summarize({k: v for k, v in final.items() if k != "__interrupt__"})}


@demo("lg-timetravel", LG, "Time travel (replay & fork)")
def time_travel(ctx: Ctx):
    class State(TypedDict):
        topic: str
        joke: str
        rating: str

    model = ctx.model(script=lambda m, c: f"Why did the {last_text(m).split('about ')[-1].rstrip('.')} cross the road? To get to the other graph.")

    def pick_topic(state: State):
        return {"topic": state.get("topic") or "chicken"}

    def write_joke(state: State):
        return {"joke": model.invoke(f"Write a one-line joke about {state['topic']}.").text}

    def rate(state: State):
        return {"rating": f"{len(state['joke']) % 5 + 6}/10"}

    graph = (StateGraph(State).add_node("pick_topic", pick_topic).add_node("write_joke", write_joke).add_node("rate", rate)
             .add_edge(START, "pick_topic").add_edge("pick_topic", "write_joke").add_edge("write_joke", "rate").add_edge("rate", END)
             .compile(checkpointer=InMemorySaver()))
    config = {**ctx.config, "configurable": {"thread_id": "time-travel"}}

    original = graph.invoke({"topic": ctx.text("topic", "robot")}, config=config)
    history = list(graph.get_state_history(config))
    before_joke = next(h for h in history if h.next == ("write_joke",))   # the checkpoint just before write_joke

    fork_config = graph.update_state(before_joke.config, {"topic": ctx.text("new_topic", "penguin")})  # edit the past
    forked = graph.invoke(None, config={**ctx.config, **fork_config})     # None = continue from that checkpoint

    ctx.draw(graph)
    ctx.check("Fork re-ran only the steps after the checkpoint", forked["topic"] == ctx.text("new_topic", "penguin") and forked["joke"] != original["joke"])
    ctx.check("Original timeline still in history", any(h.values.get("joke") == original["joke"] for h in graph.get_state_history(config)))
    full = list(graph.get_state_history(config))
    return {"kind": "timetravel", "original": original, "forked": forked, "fork_from": before_joke.config["configurable"]["checkpoint_id"],
            "checkpoints": [{"id": h.config["configurable"]["checkpoint_id"], "parent": (h.parent_config or {}).get("configurable", {}).get("checkpoint_id"),
                             "step": h.metadata.get("step"), "source": h.metadata.get("source"), "next": list(h.next), "values": summarize(h.values)} for h in full]}


@demo("lg-streaming", LG, "Stream modes")
def stream_modes(ctx: Ctx):
    class State(TypedDict):
        topic: str
        outline: list[str]
        answer: str

    model = ctx.model(script=lambda m, c: "Streaming lets users see progress immediately instead of waiting for the full answer.")

    def research(state: State):
        writer = get_stream_writer()                   # custom progress events
        outline = []
        for i, part in enumerate(["background", "key idea", "example"], 1):
            time.sleep(0.15)
            outline.append(part)
            writer({"progress": f"{i}/3", "found": part})
        return {"outline": outline}

    def answer(state: State):
        return {"answer": model.invoke(f"Explain {state['topic']} covering {', '.join(state['outline'])}.").text}

    graph = (StateGraph(State).add_node("research", research).add_node("answer", answer)
             .add_edge(START, "research").add_edge("research", "answer").add_edge("answer", END).compile())

    modes = ["values", "updates", "custom", "messages"]
    for mode, chunk in graph.stream({"topic": ctx.text("topic", "streaming")}, config=ctx.config, stream_mode=modes):
        if mode == "messages":
            token, meta = chunk                        # (message chunk, metadata) per LLM token
            ctx.event("messages", {"token": token.content, "node": meta.get("langgraph_node")}, node=meta.get("langgraph_node"))
        else:
            ctx.event(mode, chunk, node=next(iter(chunk)) if mode == "updates" else None)

    ctx.draw(graph)
    seen = {e["label"] for e in ctx.events}
    ctx.check("All four stream modes produced events", seen == set(modes), sorted(seen))
    ctx.check("Tokens streamed from inside a node", sum(e["label"] == "messages" for e in ctx.events) > 3)
    return {"kind": "lanes", "modes": modes}


@demo("lg-send", LG, "Map-reduce with Send")
def map_reduce(ctx: Ctx):
    class State(TypedDict):
        topics: list[str]
        facts: Annotated[list[str], operator.add]     # every parallel worker appends here
        summary: str

    model = ctx.model(script=_fact_script, mock_latency=0.5)

    def fan_out(state: State):                         # one Send per topic -> parallel copies of write_fact
        return [Send("write_fact", {"topic": t}) for t in state["topics"]]

    def write_fact(item: dict):
        return {"facts": [model.invoke(f"Give one surprising fact about: {item['topic']}").text]}

    def combine(state: State):
        return {"summary": f"Collected {len(state['facts'])} facts in parallel."}

    builder = StateGraph(State)
    builder.add_node("write_fact", write_fact).add_node("combine", combine)
    builder.add_conditional_edges(START, fan_out, ["write_fact"])
    builder.add_edge("write_fact", "combine").add_edge("combine", END)
    graph = builder.compile()

    topics = [t.strip() for t in ctx.text("topics", "octopus, volcano, honey, saturn").split(",") if t.strip()][:8]
    t0 = time.perf_counter()
    final = _record(ctx, graph.stream({"topics": topics, "facts": []}, config=ctx.config, stream_mode=["updates", "values"]))
    wall_ms = (time.perf_counter() - t0) * 1000

    ctx.draw(graph)
    llm_ms = sum(r.get("durationMs", 0) for r in ctx.tracer.steps(set()) if r["kind"] == "llm")
    ctx.check("One fact per topic", len(final["facts"]) == len(topics), len(final["facts"]))
    ctx.check("Workers ran in parallel", len(topics) < 2 or wall_ms < llm_ms * 0.9, {"wall_ms": round(wall_ms), "sum_ms": round(llm_ms)})
    return {"kind": "state", "final": final, "timing": {"wallMs": round(wall_ms), "sumOfModelCallsMs": round(llm_ms)}}


@demo("lg-subgraphs", LG, "Subgraphs")
def subgraphs(ctx: Ctx):
    class ResearchState(TypedDict):
        question: str
        notes: Annotated[list[str], operator.add]

    def search(state: ResearchState):
        return {"notes": [f"source A on '{state['question']}'", f"source B on '{state['question']}'"]}

    def summarize_notes(state: ResearchState):
        return {"notes": [f"summary of {len(state['notes'])} sources"]}

    research = (StateGraph(ResearchState).add_node("search", search).add_node("summarize_notes", summarize_notes)
                .add_edge(START, "search").add_edge("search", "summarize_notes").add_edge("summarize_notes", END).compile())

    class ParentState(TypedDict):
        question: str
        notes: Annotated[list[str], operator.add]     # shared key: the subgraph writes into it
        report: str

    def plan(state: ParentState):
        return {"notes": ["plan: research, then write"]}

    def write(state: ParentState):
        return {"report": f"Report built from {len(state['notes'])} notes."}

    graph = (StateGraph(ParentState).add_node("plan", plan).add_node("research", research)   # a compiled graph is a node
             .add_node("write", write).add_edge(START, "plan").add_edge("plan", "research")
             .add_edge("research", "write").add_edge("write", END).compile())

    final = {}
    for namespace, mode, chunk in graph.stream({"question": ctx.text("question", "Why do agents need state?"), "notes": []},
                                               config=ctx.config, stream_mode=["updates", "values"], subgraphs=True):
        scope = "/".join(n.split(":")[0] for n in namespace) or "parent"
        if mode == "updates":
            for node, update in chunk.items():
                ctx.event(f"{scope} › {node}", update, node=node)
        elif not namespace:
            final = chunk

    ctx.draw(graph, xray=True)                          # xray draws the subgraph's inner nodes
    ctx.check("Subgraph nodes streamed with their namespace", any(e["label"].startswith("research ›") for e in ctx.events))
    ctx.check("Subgraph output merged into the parent state", any("summary of" in n for n in final["notes"]))
    return {"kind": "state", "final": final}


@demo("lg-command", LG, "Command: update + goto (handoffs)")
def command_handoffs(ctx: Ctx):
    class State(TypedDict):
        message: str
        path: Annotated[list[str], operator.add]
        answer: str

    def triage(state: State) -> Command[Literal["billing_agent", "tech_agent"]]:
        goto = "billing_agent" if re.search(r"refund|invoice|charge", state["message"], re.I) else "tech_agent"
        return Command(goto=goto, update={"path": [f"triage → {goto}"]})   # route and update in one return

    def tech_agent(state: State) -> Command[Literal["billing_agent", "__end__"]]:
        if re.search(r"plan|upgrade|price", state["message"], re.I):    # hand off mid-conversation
            return Command(goto="billing_agent", update={"path": ["tech_agent → billing_agent (handoff)"]})
        return Command(goto=END, update={"path": ["tech_agent answered"], "answer": "Try clearing the cache and restarting."})

    def billing_agent(state: State) -> Command[Literal["__end__"]]:
        return Command(goto=END, update={"path": ["billing_agent answered"], "answer": "I've opened a billing case for you."})

    graph = (StateGraph(State).add_node("triage", triage).add_node("tech_agent", tech_agent).add_node("billing_agent", billing_agent)
             .add_edge(START, "triage").compile())

    final = _record(ctx, graph.stream({"message": ctx.text("message", "The app crashes when I try to upgrade my plan"), "path": []},
                                      config=ctx.config, stream_mode=["updates", "values"]))
    ctx.draw(graph)
    ctx.check("Routing came from Command(goto=…) with no static edges out of triage", final["path"][0].startswith("triage →"))
    ctx.check("Finished with an answer", bool(final.get("answer")))
    return {"kind": "state", "final": final}


_STORE = InMemoryStore(index={"embed": HashingEmbeddings(), "dims": 256})   # semantic search over memories
_STORE_THREADS = InMemorySaver()


@demo("lg-store", LG, "Long-term memory (Store)", stateful=True)
def long_term_memory(ctx: Ctx):
    model = ctx.model(script=_store_script)

    def remember_or_recall(state: MessagesState, runtime: Runtime):
        user = runtime.context["user_id"]
        text = state["messages"][-1].text
        namespace = ("memories", user)                 # memories are scoped per user, shared by all threads
        if text.lower().startswith("remember"):
            runtime.store.put(namespace, uuid.uuid4().hex, {"text": text.split(" ", 1)[-1]})
            return {"messages": [AIMessage(f"Saved to long-term memory for {user}.")]}
        hits = runtime.store.search(namespace, query=text, limit=3)
        known = "\n".join(f"- {h.value['text']}" for h in hits)
        reply = model.invoke([SystemMessage(f"Answer using these memories about the user:\n{known}"), HumanMessage(text)])
        return {"messages": [reply]}

    graph = (StateGraph(MessagesState, context_schema=dict).add_node("remember_or_recall", remember_or_recall)
             .add_edge(START, "remember_or_recall").add_edge("remember_or_recall", END)
             .compile(checkpointer=_STORE_THREADS, store=_STORE))

    user = ctx.text("user_id", "ada")[:30]
    thread = ctx.text("thread", f"thread-{uuid.uuid4().hex[:4]}")[:40]
    result = graph.invoke({"messages": [HumanMessage(ctx.text("message", "Remember that I prefer oat milk lattes"))]},
                          config={**ctx.config, "configurable": {"thread_id": f"lg-store:{thread}"}}, context={"user_id": user})

    items = _STORE.search(("memories", user), query=ctx.text("message", ""), limit=10)
    ctx.draw(graph)
    if ctx.text("message", "Remember").lower().startswith("remember"):
        ctx.check("Memory saved under ('memories', user)", len(items) > 0, len(items))
    else:
        ctx.check("Recall searched only this user's namespace", all(i.namespace == ("memories", user) for i in items), len(items))
    ctx.check("Node replied", result["messages"][-1].type == "ai")
    return {"kind": "store", "reply": result["messages"][-1].text, "thread": thread, "user": user,
            "memories": [{"key": i.key, "text": i.value["text"], "score": round(i.score, 3) if i.score is not None else None} for i in items]}


@demo("lg-functional", LG, "Functional API (@entrypoint / @task)")
def functional_api(ctx: Ctx):
    model = ctx.model(script=_fact_script, mock_latency=0.4)

    @task
    def research(topic: str) -> str:                   # tasks run in parallel and their results are checkpointed
        return model.invoke(f"Give one surprising fact about: {topic}").text

    @task
    def combine(facts: list[str]) -> str:
        return " | ".join(facts)

    @entrypoint(checkpointer=InMemorySaver())          # plain Python control flow, LangGraph persistence
    def workflow(topics: list[str]) -> dict:
        futures = [research(t) for t in topics]        # start all tasks
        facts = [f.result() for f in futures]          # wait for them
        return {"facts": facts, "combined": combine(facts).result()}

    topics = [t.strip() for t in ctx.text("topics", "comets, coral, crows").split(",") if t.strip()][:6]
    t0 = time.perf_counter()
    result = workflow.invoke(topics, config={**ctx.config, "configurable": {"thread_id": "functional"}})
    wall_ms = (time.perf_counter() - t0) * 1000

    ctx.draw(workflow)
    llm_ms = sum(r.get("durationMs", 0) for r in ctx.tracer.steps(set()) if r["kind"] == "llm")
    ctx.check("One result per task", len(result["facts"]) == len(topics))
    ctx.check("Tasks ran concurrently", len(topics) < 2 or wall_ms < llm_ms * 0.9, {"wall_ms": round(wall_ms), "sum_ms": round(llm_ms)})
    return {"kind": "json", "data": result, "timing": {"wallMs": round(wall_ms), "sumOfModelCallsMs": round(llm_ms)}}


@demo("lg-policies", LG, "Node retries & caching")
def node_policies(ctx: Ctx):
    calls = {"flaky": 0, "expensive": 0}

    class State(TypedDict):
        query: str
        fetched: str
        enriched: str

    def flaky_fetch(state: State):
        calls["flaky"] += 1
        if calls["flaky"] % 3 != 0:                     # fails twice, succeeds on the 3rd attempt
            raise ConnectionError("upstream API returned 503")
        return {"fetched": f"data for {state['query']}"}

    def expensive_enrich(state: State):
        calls["expensive"] += 1
        time.sleep(0.6)                                 # pretend this is a slow model or API call
        return {"enriched": state["fetched"].upper()}

    builder = StateGraph(State)
    builder.add_node("flaky_fetch", flaky_fetch, retry_policy=RetryPolicy(max_attempts=3, initial_interval=0.05, jitter=False))
    builder.add_node("expensive_enrich", expensive_enrich, cache_policy=CachePolicy(ttl=120))  # keyed on the node's input
    builder.add_edge(START, "flaky_fetch").add_edge("flaky_fetch", "expensive_enrich").add_edge("expensive_enrich", END)
    graph = builder.compile(cache=InMemoryCache())

    query = ctx.text("query", "weather in Austin")
    timings = []
    for run in (1, 2):
        t0 = time.perf_counter()
        _record(ctx, graph.stream({"query": query}, config=ctx.config, stream_mode=["updates", "values"]))
        timings.append({"label": f"run {run}", "ms": round((time.perf_counter() - t0) * 1000)})

    ctx.draw(graph)
    ctx.check("RetryPolicy retried the flaky node", calls["flaky"] == 6, calls)
    ctx.check("CachePolicy skipped the expensive node on run 2", calls["expensive"] == 1, calls)
    ctx.check("Cached run was faster", timings[1]["ms"] < timings[0]["ms"], timings)
    return {"kind": "timings", "bars": timings, "calls": calls}
