"""LangChain feature demos. Each function is shown verbatim in the UI as "the code that ran"."""

from __future__ import annotations

import os
import re
import time
from typing import Literal, Optional

from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware, before_model, dynamic_prompt, wrap_tool_call
from langchain_core.caches import InMemoryCache
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.documents import Document
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, trim_messages
from langchain_core.output_parsers import CommaSeparatedListOutputParser, StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnableLambda, RunnableParallel, RunnablePassthrough
from langchain_core.vectorstores import InMemoryVectorStore
from langgraph.checkpoint.memory import InMemorySaver
from langchain_text_splitters import CharacterTextSplitter, MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field

from ..core import Ctx, demo, summarize
from ..llm import HashingEmbeddings, last_text, tool_call
from .shared import HANDBOOK, TOOLS, agent_script, calculator, first_sentence_match, get_weather, tool_results

LC = "langchain"


# ---- Scripts for the offline model ---------------------------------------------------------------

FUN_FACTS = {
    "octopus": "An octopus has three hearts and blue, copper-based blood.",
    "owl": "Owls can't move their eyes, so they rotate their heads up to about 270 degrees instead.",
    "otter": "Sea otters often hold paws while sleeping so they don't drift apart.",
    "orca": "Orcas are the largest members of the dolphin family.",
    "ostrich": "Ostriches lay the largest eggs of any living bird.",
    "okapi": "The okapi looks like a zebra but its closest living relative is the giraffe.",
}

TRANSLATIONS = {
    "French": "Un modèle de prompt est un gabarit réutilisable : on y insère des variables au moment de l'exécution pour produire les messages envoyés au modèle.",
    "Spanish": "Una plantilla de prompt es un molde reutilizable: rellenas sus variables en tiempo de ejecución y produce los mensajes que se envían al modelo.",
    "English": "A prompt template is a reusable blueprint: you fill in its variables at run time and it produces the messages sent to the model.",
}


def _explain_script(messages, ctx):
    q = last_text(messages).strip()
    system = next((str(m.content) for m in messages if m.type == "system"), "")
    if (lang := re.search(r"answer in (\w+)", system, re.I)) and "prompt" in q.lower():
        return TRANSLATIONS.get(lang.group(1).title(), TRANSLATIONS["English"])
    if m := re.search(r"fun fact about (\w+)", q, re.I):
        return FUN_FACTS.get(m.group(1).lower(), f"The {m.group(1)} is more surprising than it looks.")
    if m := re.search(r"benefit of (.+?)\.?$", q, re.I):
        return f"{m.group(1).capitalize()} shows you what your system is actually doing, so you find and fix problems in minutes instead of days."
    if m := re.search(r"paragraph about (.+?)\.?$", q, re.I):
        return (f"When it comes to {m.group(1)}, the key idea is simple: show progress as it happens. Instead of waiting for the "
                "whole response, each piece appears the moment it is ready, so the app feels fast and people can stop or redirect early.")
    if m := re.search(r"explain (.+?) to an? (.+?) in", q, re.I):
        return (f"Think of {m.group(1)} as a tool built for one job: you give it data, it gives you back exactly what that job needs. "
                f"As a {m.group(2)}, learn what goes in and what comes out first, then the internals as you need them.")
    if "fallback" in q.lower():
        return "with_fallbacks() wraps a Runnable with backups: if the first one raises, the next is tried with the same input."
    if "chat model" in q.lower():
        return ("A chat model takes a list of messages and returns an AIMessage. LangChain gives every provider the same interface, "
                "so you can swap models without changing the rest of your code.")
    return (f"(Offline scripted model) In live mode Claude would answer “{q[:160]}”. This reply still went through "
            "LangChain's real BaseChatModel interface: messages in, AIMessage out.")


def _summary_script(messages, ctx):
    text = last_text(messages)
    if "comma-separated" in text or "keywords" in text.lower():
        words = sorted({w.lower() for w in re.findall(r"[A-Za-z]{6,}", text.split(":", 1)[-1])}, key=len, reverse=True)[:5]
        return ", ".join(words)
    body = text.split(":", 1)[-1].strip()
    first = re.split(r"(?<=[.!?])\s", body)[0]
    return f"In short: {first}"


def _ticket_script(messages, ctx):
    text = last_text(messages)
    low = text.lower()
    category = "billing" if any(w in low for w in ("charge", "refund", "invoice", "bill")) else \
        "bug" if any(w in low for w in ("crash", "error", "broken", "bug")) else \
        "account" if any(w in low for w in ("password", "login", "account")) else "other"
    priority = "high" if any(w in low for w in ("urgent", "asap", "immediately", "twice", "!!")) else "medium"
    name = re.search(r"(?:I am|I'm|this is|name is) ([A-Z][a-z]+)", text)
    order = re.search(r"#?\b([A-Z]{2,}-?\d{3,})\b", text)
    args = {"category": category, "priority": priority, "summary": re.split(r"(?<=[.!?])\s", text.strip())[0][:120],
            "customer_name": name.group(1) if name else None, "order_id": order.group(1) if order else None}
    schema = ctx["tools"][0] if ctx["tools"] else "SupportTicket"
    return AIMessage(content="", tool_calls=[tool_call(schema, args)])


def _rag_script(messages, ctx):
    prompt = last_text(messages)
    context = prompt.split("Context:", 1)[-1].split("Question:", 1)[0]
    question = prompt.split("Question:", 1)[-1]
    return first_sentence_match(context, question)


def _memory_script(messages, ctx):
    question = last_text(messages)
    history = [m for m in messages[:-1] if m.type in ("human", "ai")]
    name = None
    for m in messages:
        found = re.search(r"my name is ([A-Za-z]+)", str(m.content), re.I) if m.type == "human" else None
        if found:
            name = found.group(1).title()
    if re.search(r"\bmy name is\b", question, re.I):
        return f"Nice to meet you, {name}! I'll remember that."
    if "name" in question.lower() and "?" in question:
        return f"Your name is {name}." if name else "You haven't told me your name yet."
    return f"Got it. (I can see {len(history)} earlier messages in this session.)"


# ---- Demos ---------------------------------------------------------------------------------------

@demo("lc-models", LC, "Chat models & messages")
def chat_models(ctx: Ctx):
    model = ctx.model(script=_explain_script)  # ChatAnthropic(model="claude-…") when a key is set

    messages = [
        SystemMessage("You are a concise assistant. Answer in at most two sentences."),
        HumanMessage(ctx.text("question", "What is a chat model in LangChain?")),
    ]
    reply = model.invoke(messages, config=ctx.config)

    ctx.draw_manual(["messages", "model", "reply"], [("messages", "model"), ("model", "reply")],
                    {"messages": "[System, Human]", "model": type(model).__name__, "reply": "AIMessage"}, {"model": "llm"})
    ctx.check("Reply is an AIMessage", isinstance(reply, AIMessage))
    ctx.check("Reply has text content", bool(reply.text.strip()))
    ctx.check("Token usage is reported (usage_metadata)", (reply.usage_metadata or {}).get("total_tokens", 0) > 0, reply.usage_metadata)
    return {"kind": "messages", "messages": summarize(messages + [reply]),
            "usage": reply.usage_metadata, "metadata": summarize(reply.response_metadata)}


@demo("lc-prompts", LC, "Prompt templates")
def prompt_templates(ctx: Ctx):
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a friendly {role}. Always answer in {language}."),
        MessagesPlaceholder("history"),
        ("human", "{question}"),
    ]).partial(role="teacher")  # pre-fill a variable once

    variables = {
        "language": ctx.text("language", "English"),
        "history": [HumanMessage("Hi!"), AIMessage("Hello! What would you like to learn?")],
        "question": ctx.text("question", "Explain prompt templates"),
    }
    formatted = prompt.invoke(variables, config=ctx.config)  # -> ChatPromptValue
    chain = prompt | ctx.model(script=_explain_script)
    reply = chain.invoke(variables, config=ctx.config)

    ctx.draw(chain)
    ctx.check("Template variables detected", set(prompt.input_variables) == {"language", "history", "question"}, prompt.input_variables)
    ctx.check("Formatted into 4 messages", len(formatted.to_messages()) == 4)
    ctx.check("Placeholder filled with the history", formatted.to_messages()[1].content == "Hi!")
    return {"kind": "messages", "messages": summarize(formatted.to_messages() + [reply]),
            "variables": prompt.input_variables, "partials": list(prompt.partial_variables)}


@demo("lc-lcel", LC, "LCEL chains (the | operator)")
def lcel_chain(ctx: Ctx):
    prompt = ChatPromptTemplate.from_template("Explain {topic} to a {audience} in two sentences.")
    model = ctx.model(script=_explain_script)
    parser = StrOutputParser()

    chain = prompt | model | parser  # a RunnableSequence: invoke / stream / batch for free

    answer = chain.invoke({"topic": ctx.text("topic", "vector databases"), "audience": ctx.text("audience", "new developer")},
                          config=ctx.config)

    ctx.draw(chain)
    ctx.check("Output parser returned a plain string", isinstance(answer, str) and len(answer) > 0)
    ctx.check("Chain has 3 steps", len(chain.steps) == 3, [type(s).__name__ for s in chain.steps])
    return {"kind": "text", "text": answer, "steps": [type(s).__name__ for s in chain.steps],
            "input_schema": chain.input_schema.model_json_schema().get("properties")}


@demo("lc-parallel", LC, "Parallel, Passthrough & Lambda")
def parallel_runnables(ctx: Ctx):
    model = ctx.model(script=_summary_script, mock_latency=0.6)
    summary = ChatPromptTemplate.from_template("Summarise in one sentence: {text}") | model | StrOutputParser()
    keywords = (ChatPromptTemplate.from_template("Give 5 comma-separated keywords for: {text}")
                | model | CommaSeparatedListOutputParser())
    stats = RunnableLambda(lambda x: {"words": len(x["text"].split()), "characters": len(x["text"])})

    chain = RunnablePassthrough.assign(  # keep the input, add three branches computed concurrently
        analysis=RunnableParallel(summary=summary, keywords=keywords, stats=stats)
    )
    text = ctx.text("text", "LangGraph lets developers model agents as graphs. Nodes do work, edges decide what runs next, "
                            "and a checkpointer saves state so long-running workflows can pause and resume.")
    started = time.perf_counter()
    result = chain.invoke({"text": text}, config=ctx.config)
    wall_ms = (time.perf_counter() - started) * 1000

    ctx.draw(chain)
    llm_runs = [r for r in ctx.tracer.steps(set()) if r["kind"] == "llm"]
    serial_ms = sum(r.get("durationMs", 0) for r in llm_runs)
    ctx.check("Both model branches ran", len(llm_runs) == 2)
    ctx.check("Branches overlapped (wall time < sum of model calls)", wall_ms < serial_ms * 0.95, {"wall_ms": round(wall_ms), "sum_ms": round(serial_ms)})
    ctx.check("Passthrough kept the original input", result["text"] == text)
    return {"kind": "json", "data": summarize(result), "timing": {"wallMs": round(wall_ms), "sumOfModelCallsMs": round(serial_ms)}}


class SupportTicket(BaseModel):
    """A support ticket extracted from a customer email."""
    category: Literal["billing", "bug", "account", "other"]
    priority: Literal["low", "medium", "high"]
    summary: str = Field(description="One-line summary of the problem")
    customer_name: Optional[str] = Field(default=None, description="The customer's first name if given")
    order_id: Optional[str] = Field(default=None, description="Order or invoice id if mentioned")


@demo("lc-structured", LC, "Structured output")
def structured_output(ctx: Ctx):
    model = ctx.model(script=_ticket_script)
    extractor = model.with_structured_output(SupportTicket)  # schema -> tool definition -> validated object

    email = ctx.text("email", "Hi, I'm Dana. I was charged twice for order ORD-48213 and need a refund urgently!")
    ticket = extractor.invoke([SystemMessage("Extract a support ticket from the email."), HumanMessage(email)],
                              config=ctx.config)

    ctx.draw(extractor)
    ctx.check("Returned a validated SupportTicket instance", isinstance(ticket, SupportTicket))
    ctx.check("Category is one of the allowed literals", ticket.category in ("billing", "bug", "account", "other"))
    return {"kind": "json", "data": ticket.model_dump(), "schema": SupportTicket.model_json_schema()}


@demo("lc-streaming", LC, "Streaming tokens")
def streaming(ctx: Ctx):
    chain = ChatPromptTemplate.from_template("Write a short paragraph about {topic}.") | ctx.model(script=_explain_script) | StrOutputParser()

    pieces = []
    for chunk in chain.stream({"topic": ctx.text("topic", "why streaming improves UX")}, config=ctx.config):
        pieces.append(chunk)          # each chunk arrives as soon as the model produces it
        ctx.event("chunk", chunk)

    ctx.draw(chain)
    ctx.check("Received more than one chunk", len(pieces) > 1, len(pieces))
    ctx.check("Chunks join into the full answer", len("".join(pieces)) > 0)
    return {"kind": "stream", "chunks": pieces, "text": "".join(pieces)}


@demo("lc-tools", LC, "Tool calling")
def tool_calling(ctx: Ctx):
    tools = {t.name: t for t in (get_weather, calculator)}  # @tool turns a typed function into a schema
    model = ctx.model(script=agent_script).bind_tools(list(tools.values()))

    messages = [HumanMessage(ctx.text("question", "What's the weather in Tokyo, and what is 23 * 19?"))]
    ai = model.invoke(messages, config=ctx.config)       # 1. the model asks for tools
    messages.append(ai)
    for call in ai.tool_calls:                           # 2. we run them
        messages.append(tools[call["name"]].invoke(call, config=ctx.config))  # -> ToolMessage
    final = model.invoke(messages, config=ctx.config)    # 3. the model answers with the results
    messages.append(final)

    ctx.draw_manual(["question", "model", "tools", "answer"],
                    [("question", "model"), ("model", "tools", True, "tool_calls"), ("tools", "model", False, "ToolMessage"), ("model", "answer", True, "no tool calls")],
                    {"question": "HumanMessage", "model": "model.bind_tools()", "tools": "get_weather / calculator", "answer": "final AIMessage"},
                    {"model": "llm", "tools": "tool"})
    ctx.check("Model requested at least one tool", len(ai.tool_calls) > 0, [c["name"] for c in ai.tool_calls])
    ctx.check("Every tool call got a ToolMessage", len(tool_results(messages[:-1])) == len(ai.tool_calls))
    ctx.check("Final answer has no further tool calls", not final.tool_calls)
    return {"kind": "messages", "messages": summarize(messages),
            "tool_schemas": [t.tool_call_schema.model_json_schema() for t in tools.values()]}


@demo("lc-agent", LC, "Agents with create_agent & middleware")
def agent(ctx: Ctx):
    log: list[str] = []

    @before_model
    def log_turn(state, runtime):                     # runs before every model call
        log.append(f"before_model: {len(state['messages'])} messages")

    @wrap_tool_call
    def audit_tools(request, handler):                # wraps every tool execution
        log.append(f"tool → {request.tool_call['name']}({request.tool_call['args']})")
        return handler(request)

    @dynamic_prompt
    def persona(request):                             # system prompt computed per call
        return f"You are a helpful assistant. Today is {time.strftime('%A')}. Use tools when useful."

    agent = create_agent(
        ctx.model(script=agent_script),
        tools=TOOLS,
        middleware=[persona, log_turn, audit_tools, ModelCallLimitMiddleware(run_limit=6)],
    )
    result = agent.invoke({"messages": [HumanMessage(ctx.text("question", "What is the weather in Paris? Also compute 128 / 4."))]},
                          config=ctx.config)

    ctx.draw(agent)
    tool_msgs = [m for m in result["messages"] if m.type == "tool"]
    ctx.check("Agent called tools on its own", len(tool_msgs) > 0, [m.name for m in tool_msgs])
    ctx.check("Middleware hooks ran", any(l.startswith("before_model") for l in log) and any(l.startswith("tool") for l in log), log)
    ctx.check("Ended with a final answer", result["messages"][-1].type == "ai" and not result["messages"][-1].tool_calls)
    return {"kind": "messages", "messages": summarize(result["messages"]), "middleware_log": log}


@demo("lc-splitters", LC, "Documents & text splitters")
def text_splitters(ctx: Ctx):
    size, overlap = ctx.int("chunk_size", 220, 60, 1000), ctx.int("chunk_overlap", 40, 0, 200)
    kind = ctx.text("splitter", "recursive")
    doc = Document(page_content=HANDBOOK, metadata={"source": "handbook.md"})

    if kind == "markdown":
        splitter = MarkdownHeaderTextSplitter([("#", "title"), ("##", "section")], strip_headers=False)
        chunks = splitter.split_text(doc.page_content)
        for chunk in chunks:
            chunk.metadata["start_index"] = doc.page_content.find(chunk.page_content[:40])
    else:
        cls = RecursiveCharacterTextSplitter if kind == "recursive" else CharacterTextSplitter
        splitter = cls(chunk_size=size, chunk_overlap=min(overlap, size - 1), add_start_index=True,
                       **({} if kind == "recursive" else {"separator": "\n"}))
        chunks = splitter.split_documents([doc])

    ctx.draw_manual(["document", "splitter", "chunks"], [("document", "splitter"), ("splitter", "chunks")],
                    {"document": "Document (handbook.md)", "splitter": type(splitter).__name__, "chunks": f"{len(chunks)} chunks"})
    ctx.check("Produced several chunks", len(chunks) > 1, len(chunks))
    if kind != "markdown":
        ctx.check("No chunk exceeds chunk_size", all(len(c.page_content) <= size for c in chunks))
    ctx.check("Every chunk keeps its position (start_index)", all(c.metadata.get("start_index", -1) >= 0 for c in chunks))
    return {"kind": "chunks", "source": HANDBOOK,
            "chunks": [{"text": c.page_content, "start": c.metadata.get("start_index"), "metadata": c.metadata} for c in chunks]}


@demo("lc-rag", LC, "Retrieval-augmented generation (RAG)")
def rag(ctx: Ctx):
    chunks = RecursiveCharacterTextSplitter(chunk_size=240, chunk_overlap=30).split_documents(
        [Document(page_content=HANDBOOK, metadata={"source": "handbook.md"})])
    store = InMemoryVectorStore.from_documents(chunks, embedding=HashingEmbeddings())  # index: embed every chunk
    retriever = store.as_retriever(search_kwargs={"k": 3})

    prompt = ChatPromptTemplate.from_template(
        "Answer using only this context. If it isn't there, say you don't know.\n\nContext:\n{context}\n\nQuestion: {question}")
    format_docs = RunnableLambda(lambda docs: "\n\n".join(d.page_content for d in docs))
    chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt | ctx.model(script=_rag_script) | StrOutputParser()
    )
    question = ctx.text("question", "How many vacation days do I get?")
    answer = chain.invoke(question, config=ctx.config)
    scored = store.similarity_search_with_score(question, k=4)

    ctx.draw(chain)
    retrievals = [r for r in ctx.tracer.steps(set()) if r["kind"] == "retriever"]
    ctx.check("Retriever returned 3 chunks", len(retrievals) == 1 and len(retrievals[0].get("output") or []) == 3)
    ctx.check("Top hit is relevant (score > 0.15)", scored[0][1] > 0.15, round(scored[0][1], 3))
    ctx.check("Answer generated", len(answer) > 0)
    return {"kind": "rag", "answer": answer, "chunk_count": len(chunks),
            "hits": [{"text": d.page_content, "score": round(s, 3), "section": d.page_content.split("\n")[0]} for d, s in scored]}


_MEMORY = InMemorySaver()  # module-level so conversations survive between requests


@demo("lc-memory", LC, "Short-term memory", stateful=True)
def short_term_memory(ctx: Ctx):
    # LangChain 1.x keeps conversation memory with a LangGraph checkpointer:
    # every turn is saved under the thread_id and replayed into the next call.
    agent = create_agent(ctx.model(script=_memory_script), tools=[],
                         system_prompt="You are a friendly assistant. Keep replies to one sentence.",
                         checkpointer=_MEMORY)
    config = {**ctx.config, "configurable": {"thread_id": f"lc-memory:{ctx.text('session', 'demo')[:40]}"}}

    if ctx.text("action", "send") == "clear":
        _MEMORY.delete_thread(config["configurable"]["thread_id"])
    else:
        agent.invoke({"messages": [HumanMessage(ctx.text("message", "Hi, my name is Ada."))]}, config=config)

    history = agent.get_state(config).values.get("messages", [])
    trimmed = trim_messages(history, max_tokens=6, token_counter=len, strategy="last", start_on="human")  # keep the last N messages

    ctx.draw(agent)
    ctx.check("State saved under the thread_id", ctx.text("action", "send") == "clear" or len(history) >= 2, len(history))
    ctx.check("History alternates human / AI", all(m.type in ("human", "ai") for m in history))
    return {"kind": "messages", "messages": summarize(history), "session": ctx.text("session", "demo"),
            "trimmed_to": len(trimmed)}


@demo("lc-reliability", LC, "Retries, fallbacks & caching")
def reliability(ctx: Ctx):
    attempts = {"n": 0}

    def flaky_lookup(question: str) -> str:            # fails twice, like a rate-limited API
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise ConnectionError(f"attempt {attempts['n']}: 503 Service Unavailable")
        return question

    def outage(_):                                     # a primary provider that is down
        raise TimeoutError("primary model timed out")

    model = ctx.model(script=_explain_script, mock_latency=0.5, cache=InMemoryCache())  # responses cached in memory
    answer_chain = ChatPromptTemplate.from_template("Answer briefly: {q}") | model | StrOutputParser()
    chain = (
        RunnableLambda(flaky_lookup).with_retry(stop_after_attempt=3, wait_exponential_jitter=False)
        | (lambda q: {"q": q})
        | RunnableLambda(outage).with_fallbacks([answer_chain])
    )
    question = ctx.text("question", "What does with_fallbacks do?")
    t0 = time.perf_counter(); first = chain.invoke(question, config=ctx.config); cold_ms = (time.perf_counter() - t0) * 1000
    attempts["n"] = 0
    t0 = time.perf_counter(); second = chain.invoke(question, config=ctx.config); warm_ms = (time.perf_counter() - t0) * 1000

    ctx.draw(chain)
    ctx.check("Retry recovered after 2 failures", attempts["n"] == 3, attempts["n"])
    ctx.check("Fallback answered while primary was down", len(first) > 0)
    ctx.check("Second call served from cache (identical + faster)", first == second and warm_ms < cold_ms, {"cold_ms": round(cold_ms), "warm_ms": round(warm_ms)})
    return {"kind": "timings", "text": first, "bars": [{"label": "1st call (retries + fallback + model)", "ms": round(cold_ms)},
                                                      {"label": "2nd call (model response cached)", "ms": round(warm_ms)}]}


@demo("lc-batch", LC, "Batch & concurrency")
def batching(ctx: Ctx):
    chain = ChatPromptTemplate.from_template("One-line fun fact about {animal}.") | ctx.model(script=_explain_script, mock_latency=0.4) | StrOutputParser()
    animals = [{"animal": a} for a in ("octopus", "owl", "otter", "orca", "ostrich", "okapi")]
    concurrency = ctx.int("max_concurrency", 6, 1, 6)

    t0 = time.perf_counter()
    sequential = [chain.invoke(a) for a in animals]
    seq_ms = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    batched = chain.batch(animals, config={**ctx.config, "max_concurrency": concurrency})  # thread pool under the hood
    batch_ms = (time.perf_counter() - t0) * 1000

    ctx.draw(chain)
    ctx.check("batch() returns results in input order", len(batched) == len(animals))
    ctx.check("Batching beat the sequential loop" if concurrency > 1 else "Concurrency 1 ≈ sequential", batch_ms < seq_ms * 0.8 or concurrency == 1,
              {"sequential_ms": round(seq_ms), "batch_ms": round(batch_ms)})
    return {"kind": "timings", "results": batched, "bars": [{"label": "for-loop of invoke()", "ms": round(seq_ms)},
                                                          {"label": f"batch(max_concurrency={concurrency})", "ms": round(batch_ms)}]}


@demo("lc-callbacks", LC, "Callbacks & tracing")
def callbacks(ctx: Ctx):
    class TimelineHandler(BaseCallbackHandler):         # receives an event for every step of every run
        def __init__(self):
            self.events, self.t0 = [], time.perf_counter()

        def _log(self, kind, name):
            self.events.append({"ms": round((time.perf_counter() - self.t0) * 1000, 1), "event": kind, "name": name})

        def on_chain_start(self, serialized, inputs, **kw):
            self._log("chain_start", kw.get("name") or (serialized or {}).get("name"))

        def on_chat_model_start(self, serialized, messages, **kw):
            self._log("chat_model_start", kw.get("name") or (serialized or {}).get("name"))

        def on_llm_end(self, response, **kw):
            self._log("llm_end", f"{response.generations[0][0].message.usage_metadata}")

        def on_chain_end(self, outputs, **kw):
            self._log("chain_end", "")

    handler = TimelineHandler()
    chain = ChatPromptTemplate.from_template("Name one benefit of {thing}.") | ctx.model(script=_explain_script) | StrOutputParser()
    chain.with_config(run_name="benefit-chain", tags=["demo"], metadata={"user": "visual-lab"}).invoke(
        {"thing": ctx.text("thing", "observability")}, config={"callbacks": [handler, *ctx.config["callbacks"]]})

    ctx.draw(chain)
    ctx.check("Handler saw chain and model events", {"chain_start", "chat_model_start", "llm_end"} <= {e["event"] for e in handler.events})
    return {"kind": "events", "events": handler.events,
            "langsmith": os.getenv("LANGSMITH_TRACING", "false").lower() == "true" and bool(os.getenv("LANGSMITH_API_KEY"))}
