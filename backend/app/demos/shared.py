"""Tools, sample data and the offline model scripts shared by the LangChain and LangGraph demos.

Scripts only drive ScriptedChatModel (no API key). With a key, Claude produces the replies.
"""

from __future__ import annotations

import ast
import operator
import re
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import tool

from ..llm import last_text, tool_call

# ---- Tools -----------------------------------------------------------------------------------

WEATHER = {
    "paris": ("light rain", 14), "london": ("overcast", 12), "tokyo": ("clear skies", 21),
    "new york": ("sunny", 18), "denver": ("snow showers", -2), "sydney": ("warm and humid", 26),
    "chicago": ("windy", 9), "austin": ("hot and sunny", 31),
}


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    sky, temp = WEATHER.get(city.lower().strip(), ("partly cloudy", 17))
    return f"{city.title()}: {sky}, {temp}°C"


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.USub: operator.neg, ast.Mod: operator.mod}


def _eval(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        if isinstance(node.op, ast.Pow) and abs(_eval(node.right)) > 12:
            raise ValueError("exponent too large")
        return _OPS[type(node.op)](_eval(node.left), _eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval(node.operand))
    raise ValueError("only + - * / % ** and numbers are allowed")


@tool
def calculator(expression: str) -> str:
    """Evaluate an arithmetic expression such as '(17 * 3) + 4'."""
    value = _eval(ast.parse(expression, mode="eval").body)
    return str(round(value, 6) if isinstance(value, float) else value)


@tool
def search_docs(query: str) -> str:
    """Search the LangChain/LangGraph knowledge base for a short fact."""
    q = query.lower()
    for key, fact in FACTS.items():
        if key in q:
            return fact
    return "LangChain provides model/tool/retrieval building blocks; LangGraph orchestrates them as stateful graphs."


FACTS = {
    "checkpoint": "LangGraph checkpointers save state after every super-step, keyed by thread_id.",
    "interrupt": "interrupt() pauses a LangGraph node and resumes with Command(resume=value).",
    "lcel": "LCEL composes Runnables with the | operator; every chain gets invoke, stream and batch.",
    "agent": "create_agent builds a LangGraph-powered tool-calling agent with middleware hooks.",
    "send": "Send(node, state) fans work out to parallel copies of a node (map-reduce).",
    "store": "A LangGraph Store keeps long-term memory across threads, organised by namespace.",
}

TOOLS = [get_weather, calculator, search_docs]


# ---- Script helpers ----------------------------------------------------------------------------

def find_city(text: str) -> str | None:
    low = text.lower()
    for city in WEATHER:
        if city in low:
            return city.title()
    match = re.search(r"\bin ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)", text)
    return match.group(1) if match else None


def find_expression(text: str) -> str | None:
    match = re.search(r"[-(]*\d[\d\s.+\-*/%()^]*[\d)]", text)
    if match and re.search(r"[+\-*/%^]", match.group(0)):
        return match.group(0).replace("^", "**").strip()
    return None


def tool_results(messages: list[BaseMessage]) -> list[str]:
    """Tool outputs that arrived after the most recent human message."""
    out: list[str] = []
    for message in reversed(messages):
        if message.type == "human":
            break
        if message.type == "tool":
            out.append(str(message.content))
    return list(reversed(out))


def agent_script(messages: list[BaseMessage], ctx: dict[str, Any]) -> AIMessage | str:
    """Generic tool-using agent: call the tools the question needs, then answer from their results."""
    results = tool_results(messages)
    if results:
        return "Here is what I found: " + "; ".join(results) + "."
    question = last_text(messages)
    available = set(ctx["tools"])
    calls = []
    city = find_city(question)
    if "get_weather" in available and city and ("weather" in question.lower() or "temperature" in question.lower()):
        calls.append(tool_call("get_weather", {"city": city}))
    expression = find_expression(question)
    if "calculator" in available and expression:
        calls.append(tool_call("calculator", {"expression": expression}))
    if not calls and "search_docs" in available:
        calls.append(tool_call("search_docs", {"query": question}))
    if calls:
        return AIMessage(content="", tool_calls=calls)
    return f"I can answer that directly: {question}"


def first_sentence_match(context: str, question: str) -> str:
    """Pick the context sentence sharing the most words with the question (mock 'reading')."""
    words = set(re.findall(r"[a-z]{4,}", question.lower()))
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", context) if s.strip()]
    if not sentences:
        return "I don't know based on the provided context."
    best = max(sentences, key=lambda s: len(words & set(re.findall(r"[a-z]{4,}", s.lower()))))
    return best


HANDBOOK = """# Orbital Coffee Co. employee handbook

## Working hours
Core hours are 10:00 to 15:00 in your local time zone. Outside core hours you can plan your own day.
Fridays after 13:00 are meeting-free so everyone can focus on deep work.

## Time off
Every employee gets 28 days of paid vacation per year plus local public holidays.
Unused vacation days roll over until March 31 of the following year, after which they expire.
Parental leave is 20 weeks at full pay for every parent.

## Equipment
New hires choose a laptop on their first day: a 14-inch MacBook Pro or a ThinkPad X1 Carbon.
The home-office budget is 1,200 dollars, renewed every three years, for a desk, chair or monitor.

## Expenses
Submit receipts in the Expensify app within 30 days. Meals while travelling are covered up to 60 dollars per day.
Flights longer than six hours can be booked in premium economy.

## Security
Turn on full-disk encryption and use the company password manager for every work account.
Report a lost or stolen device to security@orbital.example within one hour.
"""
