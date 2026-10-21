// "Create a project" walkthroughs and the pros/cons comparison.

export interface GuideStep {
  title: string;
  text: string;
  /** Typed out in the animated terminal. */
  commands?: string[];
  file?: { name: string; lang: 'python' | 'json' | 'bash' | 'text' | 'docker'; code: string };
}

export interface Guide {
  library: 'langchain' | 'langgraph';
  title: string;
  intro: string;
  tree: string;
  steps: GuideStep[];
}

export const LANGCHAIN_GUIDE: Guide = {
  library: 'langchain',
  title: 'Create a LangChain project',
  intro: 'LangChain gives you standard building blocks (models, prompts, tools, retrievers, agents) plus 100+ provider integrations. A project is an ordinary Python package: install the core and one integration, keep the API key in .env, and compose.',
  tree: `my-langchain-app/
├── .env                 # ANTHROPIC_API_KEY=…   (git-ignored)
├── .gitignore
├── pyproject.toml       # created by uv
├── main.py              # chains and agents
├── tools.py             # @tool functions
└── tests/
    └── test_chain.py    # fake models: no API calls`,
  steps: [
    {
      title: 'Create the project',
      text: 'uv creates the folder, a pyproject.toml and a virtual environment. Plain python -m venv and pip work too.',
      commands: ['uv init my-langchain-app', 'cd my-langchain-app'],
    },
    {
      title: 'Install LangChain and a model provider',
      text: 'langchain brings create_agent and middleware; langchain-core (installed with it) holds the interfaces; each provider is a separate package.',
      commands: ['uv add langchain langchain-anthropic python-dotenv', 'uv add --dev pytest'],
    },
    {
      title: 'Keep secrets in .env',
      text: 'Never commit keys. Load them with python-dotenv, or let Docker Compose inject them with env_file.',
      commands: ['echo "ANTHROPIC_API_KEY=sk-ant-…" > .env', 'echo ".env" >> .gitignore'],
      file: { name: '.env', lang: 'bash', code: 'ANTHROPIC_API_KEY=sk-ant-...\n# optional: trace every run in LangSmith\nLANGSMITH_TRACING=true\nLANGSMITH_API_KEY=lsv2_...' },
    },
    {
      title: 'Write your first chain',
      text: 'Compose a prompt, a model and a parser with |. The chain gets invoke, stream and batch for free.',
      file: {
        name: 'main.py', lang: 'python', code: `from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

load_dotenv()
model = init_chat_model("anthropic:claude-sonnet-5-5")

prompt = ChatPromptTemplate.from_template("Explain {topic} in two sentences.")
chain = prompt | model | StrOutputParser()

if __name__ == "__main__":
    for chunk in chain.stream({"topic": "LangChain"}):
        print(chunk, end="", flush=True)`,
      },
      commands: ['uv run main.py'],
    },
    {
      title: 'Add tools and an agent',
      text: 'create_agent runs the model ⇄ tools loop for you, with middleware for limits, human approval, summarisation and more.',
      file: {
        name: 'agent.py', lang: 'python', code: `from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain_core.tools import tool

@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"{city}: sunny, 21°C"

agent = create_agent(
    "anthropic:claude-sonnet-5-5",
    tools=[get_weather],
    system_prompt="You are a helpful travel assistant.",
    middleware=[ModelCallLimitMiddleware(run_limit=5)],
)
result = agent.invoke({"messages": [{"role": "user", "content": "Weather in Lisbon?"}]})
print(result["messages"][-1].content)`,
      },
    },
    {
      title: 'Test without calling the API',
      text: 'Fake chat models from langchain_core return scripted replies, so unit tests are fast, free and deterministic (this lab’s offline mode works the same way).',
      file: {
        name: 'tests/test_chain.py', lang: 'python', code: `from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

def test_chain_formats_answer():
    model = GenericFakeChatModel(messages=iter([AIMessage("LangChain composes LLM apps.")]))
    chain = ChatPromptTemplate.from_template("{topic}") | model | StrOutputParser()
    assert chain.invoke({"topic": "x"}) == "LangChain composes LLM apps."`,
      },
      commands: ['uv run pytest -q'],
    },
    {
      title: 'Serve it in Docker',
      text: 'Wrap the chain in an API (FastAPI here) and pass the .env file to the container at run time, never bake it into the image.',
      file: {
        name: 'Dockerfile', lang: 'docker', code: `FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev
COPY . .
CMD ["uv", "run", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]`,
      },
      commands: ['docker build -t my-langchain-app .', 'docker run --env-file .env -p 8000:8000 my-langchain-app'],
    },
  ],
};

export const LANGGRAPH_GUIDE: Guide = {
  library: 'langgraph',
  title: 'Create a LangGraph project',
  intro: 'LangGraph is a low-level runtime for stateful, long-running agents: you define state, nodes and edges, and it adds checkpoints, streaming, interrupts and time travel. The LangGraph CLI scaffolds a project and runs it locally with LangGraph Studio.',
  tree: `my-agent/
├── .env                     # ANTHROPIC_API_KEY=…   (git-ignored)
├── langgraph.json           # which graphs to serve
├── pyproject.toml
├── src/agent/
│   ├── __init__.py
│   ├── state.py             # TypedDict state + reducers
│   ├── nodes.py             # node functions
│   └── graph.py             # StateGraph wiring → graph
└── tests/
    └── test_graph.py`,
  steps: [
    {
      title: 'Install the CLI and scaffold',
      text: 'langgraph new copies a starter template. You can also start from an empty project with uv init and uv add langgraph.',
      commands: ['pip install -U "langgraph-cli[inmem]"', 'langgraph new my-agent --template new-langgraph-project-python', 'cd my-agent && pip install -e .'],
    },
    {
      title: 'Define the state',
      text: 'State is the contract between nodes. Reducers such as add_messages decide how updates merge.',
      file: {
        name: 'src/agent/state.py', lang: 'python', code: `from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages

class State(TypedDict):
    messages: Annotated[list, add_messages]   # append, replace by id
    approved: bool`,
      },
    },
    {
      title: 'Write nodes and wire the graph',
      text: 'Nodes are functions from state to a partial update. Edges, conditional edges and Command decide what runs next.',
      file: {
        name: 'src/agent/graph.py', lang: 'python', code: `from langchain.chat_models import init_chat_model
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from .state import State
from .tools import TOOLS

model = init_chat_model("anthropic:claude-sonnet-5-5").bind_tools(TOOLS)

def agent(state: State):
    return {"messages": [model.invoke(state["messages"])]}

builder = StateGraph(State)
builder.add_node("agent", agent)
builder.add_node("tools", ToolNode(TOOLS))
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", tools_condition)
builder.add_edge("tools", "agent")

graph = builder.compile()   # the Agent Server adds a checkpointer for you`,
      },
    },
    {
      title: 'Point langgraph.json at the graph',
      text: 'This file tells the CLI and the Agent Server which graphs to expose and where the .env file is.',
      file: {
        name: 'langgraph.json', lang: 'json', code: `{
  "dependencies": ["."],
  "graphs": { "agent": "./src/agent/graph.py:graph" },
  "env": ".env",
  "python_version": "3.12"
}`,
      },
    },
    {
      title: 'Run locally with LangGraph Studio',
      text: 'langgraph dev starts an in-memory Agent Server with hot reload and opens Studio, a visual debugger where you can watch each node run, edit state and replay checkpoints.',
      commands: ['langgraph dev', '# API: http://127.0.0.1:2024   Studio opens in your browser'],
    },
    {
      title: 'Call it from code',
      text: 'The SDK talks to any Agent Server: threads give you persistence, runs.stream gives you streaming, and interrupts surface as events.',
      file: {
        name: 'client.py', lang: 'python', code: `from langgraph_sdk import get_sync_client

client = get_sync_client(url="http://127.0.0.1:2024")
thread = client.threads.create()
for chunk in client.runs.stream(thread["thread_id"], "agent",
        input={"messages": [{"role": "user", "content": "Weather in Oslo?"}]},
        stream_mode="updates"):
    print(chunk.event, chunk.data)`,
      },
    },
    {
      title: 'Self-host in Docker or deploy',
      text: 'langgraph build produces a Docker image of the Agent Server (backed by Postgres and Redis for durable checkpoints and task queues). Or embed the compiled graph in your own FastAPI app with PostgresSaver, as this lab does with InMemorySaver.',
      commands: ['langgraph build -t my-agent', 'docker compose up -d   # agent + postgres + redis'],
    },
  ],
};

export interface ProCon { title: string; detail: string }

export const PROS_CONS: Record<'langchain' | 'langgraph', { tagline: string; pros: ProCon[]; cons: ProCon[] }> = {
  langchain: {
    tagline: 'High-level components and agents',
    pros: [
      { title: 'Huge integration ecosystem', detail: 'Chat models, embeddings, vector stores, document loaders and tools from hundreds of providers behind one interface.' },
      { title: 'Fastest path to a prototype', detail: 'A RAG chain or a tool-calling agent (create_agent) takes a few lines.' },
      { title: 'Swap providers easily', detail: 'BaseChatModel / Embeddings / VectorStore abstractions mean changing vendors is a one-line change.' },
      { title: 'Streaming, batch and async for free', detail: 'Every LCEL Runnable has invoke, stream, batch, astream_events and retries/fallbacks.' },
      { title: 'Middleware for common agent needs', detail: 'Limits, summarisation, PII redaction, human approval and model fallback as plug-ins.' },
    ],
    cons: [
      { title: 'Abstractions can hide details', detail: 'It is not always obvious what prompt or request is actually sent; you rely on tracing to find out.' },
      { title: 'API churn', detail: 'Many 0.x patterns (legacy chains, RunnableWithMessageHistory, AgentExecutor) were deprecated on the way to 1.x.' },
      { title: 'Linear by nature', detail: 'LCEL chains are DAGs: loops, retries of reasoning and long-running pauses need LangGraph.' },
      { title: 'Dependency weight', detail: 'Pulling in integrations adds packages; deep Runnable stacks can be hard to step through in a debugger.' },
    ],
  },
  langgraph: {
    tagline: 'Low-level orchestration for stateful agents',
    pros: [
      { title: 'Explicit control flow', detail: 'Cycles, branches, parallel fan-out (Send) and handoffs (Command) are first-class, and you can see them.' },
      { title: 'Durable execution', detail: 'Checkpoints after every step: resume after crashes, pause for days, replay and fork (time travel).' },
      { title: 'Human-in-the-loop built in', detail: 'interrupt() and Command(resume=…) make approvals and edits straightforward.' },
      { title: 'Rich streaming', detail: 'State values, per-node updates, LLM tokens and custom events, including from subgraphs.' },
      { title: 'No hidden prompts', detail: 'It adds no prompts of its own and works with any Python, with or without LangChain components.' },
    ],
    cons: [
      { title: 'More code for simple tasks', detail: 'A one-shot prompt or plain RAG does not need state, nodes and edges.' },
      { title: 'Learning curve', detail: 'State schemas, reducers, super-steps, checkpointers and threads are new concepts to master.' },
      { title: 'State design matters', detail: 'A poorly designed state schema (or a missing reducer) leads to overwritten data and conflicting parallel writes.' },
      { title: 'Operational overhead in production', detail: 'Durable persistence needs Postgres (or similar) and care with checkpoint growth; the managed platform is a paid product.' },
    ],
  },
};

export interface Scenario { need: string; pick: 'LangChain' | 'LangGraph' | 'Both'; why: string }

export const SCENARIOS: Scenario[] = [
  { need: 'Prompt → answer, summarise, translate', pick: 'LangChain', why: 'An LCEL chain is all you need.' },
  { need: 'Q&A over your documents (RAG)', pick: 'LangChain', why: 'Loaders, splitters, embeddings and retrievers are LangChain components.' },
  { need: 'Standard tool-calling assistant', pick: 'LangChain', why: 'create_agent (which runs on LangGraph) plus middleware covers it.' },
  { need: 'Custom agent loop, reflection, retries of reasoning', pick: 'LangGraph', why: 'Cycles and conditional edges are explicit.' },
  { need: 'Approvals before risky actions', pick: 'LangGraph', why: 'interrupt() + checkpoints pause and resume safely.' },
  { need: 'Long-running or resumable workflows', pick: 'LangGraph', why: 'Durable execution survives restarts.' },
  { need: 'Multi-agent systems and handoffs', pick: 'LangGraph', why: 'Subgraphs and Command(goto=…) model teams of agents.' },
  { need: 'Production agent with RAG and tools', pick: 'Both', why: 'LangChain components inside LangGraph nodes: the common real-world combination.' },
];

export interface Question { id: string; text: string; weight: number }

/** Positive weight pushes toward LangGraph, negative toward LangChain. */
export const QUESTIONS: Question[] = [
  { id: 'loops', text: 'The model must loop, reflect or retry until a condition holds', weight: 2 },
  { id: 'human', text: 'A person must approve or edit something mid-run', weight: 3 },
  { id: 'durable', text: 'Runs must survive restarts or pause for a long time', weight: 3 },
  { id: 'multi', text: 'Several agents hand work to each other', weight: 2 },
  { id: 'rag', text: 'Mostly answering questions over documents', weight: -2 },
  { id: 'simple', text: 'A single prompt/response or a fixed pipeline is enough', weight: -3 },
  { id: 'fast', text: 'I need a prototype today with off-the-shelf integrations', weight: -1 },
];
