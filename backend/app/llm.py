"""Chat model factory.

With ANTHROPIC_API_KEY set (in the git-ignored .env), demos call Claude through
langchain-anthropic. Without a key they use ScriptedChatModel: a real LangChain
BaseChatModel whose replies come from a small per-demo script, so every demo,
tool call, stream and structured output still runs through the genuine
LangChain/LangGraph machinery, just deterministically and offline.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
import uuid
from typing import Any, Callable, Iterator, Sequence

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.tools import BaseTool
from langchain_core.utils.function_calling import convert_to_openai_tool

DEFAULT_MODEL = "claude-sonnet-5-5"

# A script gets the conversation plus the bound tools / tool_choice and returns the reply.
Script = Callable[[list[BaseMessage], dict[str, Any]], "AIMessage | str"]


def api_key() -> str | None:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    return key or None


def model_name() -> str:
    return os.getenv("LLM_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def live_available() -> bool:
    return api_key() is not None


def tool_call(name: str, args: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "args": args, "id": f"call_{uuid.uuid4().hex[:10]}", "type": "tool_call"}


def last_text(messages: Sequence[BaseMessage], role: str = "human") -> str:
    for message in reversed(messages):
        if message.type == role:
            return message.text if hasattr(message, "text") else str(message.content)
    return ""


class ScriptedChatModel(BaseChatModel):
    """Offline stand-in for a chat model: same interface, scripted replies."""

    script: Script
    latency: float = 0.05
    stream_delay: float = 0.035
    model_label: str = "scripted-mock"

    @property
    def _llm_type(self) -> str:
        return "scripted-mock"

    @property
    def _identifying_params(self) -> dict[str, Any]:
        return {"model": self.model_label}

    def bind_tools(self, tools: Sequence[Any], *, tool_choice: Any = None, **kwargs: Any):
        schemas = [convert_to_openai_tool(t) for t in tools]
        return self.bind(tools=schemas, tool_choice=tool_choice, **kwargs)

    def _reply(self, messages: list[BaseMessage], kwargs: dict[str, Any]) -> AIMessage:
        tools = kwargs.get("tools") or []
        context = {
            "tools": [t["function"]["name"] for t in tools if "function" in t],
            "tool_schemas": tools,
            "tool_choice": kwargs.get("tool_choice"),
        }
        reply = self.script(messages, context)
        if isinstance(reply, str):
            reply = AIMessage(content=reply)
        prompt_tokens = sum(len(str(m.content).split()) for m in messages)
        out_tokens = max(1, len(str(reply.content).split()) + 8 * len(reply.tool_calls))
        reply.usage_metadata = {
            "input_tokens": prompt_tokens,
            "output_tokens": out_tokens,
            "total_tokens": prompt_tokens + out_tokens,
        }
        reply.response_metadata = {"model_name": self.model_label, "stop_reason": "tool_use" if reply.tool_calls else "end_turn"}
        return reply

    def _generate(self, messages, stop=None, run_manager: CallbackManagerForLLMRun | None = None, **kwargs) -> ChatResult:
        time.sleep(self.latency)
        return ChatResult(generations=[ChatGeneration(message=self._reply(messages, kwargs))])

    def _stream(self, messages, stop=None, run_manager: CallbackManagerForLLMRun | None = None, **kwargs) -> Iterator[ChatGenerationChunk]:
        time.sleep(self.latency)
        reply = self._reply(messages, kwargs)
        tokens = re.findall(r"\S+\s*", str(reply.content)) or [""]
        for i, token in enumerate(tokens):
            time.sleep(self.stream_delay)
            last = i == len(tokens) - 1
            chunk = AIMessageChunk(
                content=token,
                tool_call_chunks=[
                    {"name": c["name"], "args": json.dumps(c["args"]), "id": c["id"], "index": n, "type": "tool_call_chunk"}
                    for n, c in enumerate(reply.tool_calls)
                ] if last else [],
                usage_metadata=reply.usage_metadata if last else None,
                response_metadata=reply.response_metadata if last else {},
            )
            if run_manager:
                run_manager.on_llm_new_token(token, chunk=ChatGenerationChunk(message=chunk))
            yield ChatGenerationChunk(message=chunk)


def default_script(messages: list[BaseMessage], ctx: dict[str, Any]) -> str:
    question = last_text(messages)
    return f"(scripted reply) You said: {question[:200]}"


def make_model(mode: str, script: Script | None = None, mock_latency: float | None = None, **kwargs: Any) -> BaseChatModel:
    """Return Claude in live mode, otherwise a ScriptedChatModel driven by `script`.

    kwargs are BaseChatModel fields shared by both (e.g. cache=...); mock_latency only
    slows the scripted model so timing demos have something to show.
    """
    if mode == "live":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=model_name(), max_tokens=1024, timeout=60, max_retries=2, **kwargs)
    extra = {"latency": mock_latency} if mock_latency is not None else {}
    return ScriptedChatModel(script=script or default_script, **extra, **kwargs)


class HashingEmbeddings(Embeddings):
    """Tiny offline embedding: hashed bag of words (plus bigrams), L2-normalised.

    Lexical, not semantic, but deterministic and dependency-free, which is all the
    vector store and Store demos need. Swap in a real embedding model in production.
    """

    def __init__(self, dims: int = 256):
        self.dims = dims

    def _embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dims
        words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in _STOP]
        grams = words + [f"{a}_{b}" for a, b in zip(words, words[1:])]
        for gram in grams:
            h = int(hashlib.md5(gram.encode()).hexdigest(), 16)
            vec[h % self.dims] += 1.0 if gram in words else 0.5
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)


_STOP = set("the and for are but not you all any can had her was one our out has him his how its may new now see two who did get let put say she too use what when where which with this that from have they will your into than then them these about does".split())


def tool_names(tools: Sequence[BaseTool]) -> list[str]:
    return [t.name for t in tools]
