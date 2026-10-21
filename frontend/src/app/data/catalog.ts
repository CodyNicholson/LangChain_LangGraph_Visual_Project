// What every demo teaches. The backend supplies the code that runs and the graph it draws;
// this file supplies the explanation, the inputs and the buttons.

import { DemoInfo } from '../models';

export const LANGCHAIN_CATEGORIES = ['Models & prompts', 'Composition (LCEL)', 'Tools & agents', 'Retrieval', 'Production'];
export const LANGGRAPH_CATEGORIES = ['Graph fundamentals', 'Agents & control flow', 'Persistence & humans', 'Streaming & scale', 'Alternative APIs'];

export const DEMO_INFO: DemoInfo[] = [
  // ---- LangChain ------------------------------------------------------------------------------
  {
    id: 'lc-models', library: 'langchain', category: 'Models & prompts', title: 'Chat models & messages',
    tagline: 'One interface for every LLM provider',
    description: [
      'A chat model takes a list of messages and returns an AIMessage. SystemMessage sets behaviour, HumanMessage is the user, AIMessage is the model and ToolMessage carries tool results.',
      'Every provider integration (ChatAnthropic, ChatOpenAI, ChatOllama, …) implements the same BaseChatModel interface, so you can swap models without touching the rest of your code. init_chat_model("anthropic:claude-…") picks one from a string.',
      'The reply carries more than text: usage_metadata reports input and output tokens, and response_metadata holds provider details such as the stop reason.',
    ],
    keyApis: ['BaseChatModel.invoke', 'SystemMessage / HumanMessage / AIMessage', 'usage_metadata', 'init_chat_model'],
    useCases: ['Chatbots', 'Provider-agnostic apps', 'Cost tracking'],
    inputs: [{ name: 'question', label: 'Question', type: 'text', default: 'What is a chat model in LangChain?' }],
  },
  {
    id: 'lc-prompts', library: 'langchain', category: 'Models & prompts', title: 'Prompt templates',
    tagline: 'Reusable prompts with variables, history slots and partials',
    description: [
      'ChatPromptTemplate turns a dict of variables into a list of messages. Placeholders such as {language} are filled at run time, so one template serves every request.',
      'MessagesPlaceholder("history") reserves a slot for a whole list of messages, which is how chat history and agent scratchpads get into a prompt. .partial() pre-fills variables you already know.',
      'A template is itself a Runnable: invoke it to see the formatted messages, or pipe it into a model with |.',
    ],
    keyApis: ['ChatPromptTemplate.from_messages', 'MessagesPlaceholder', '.partial()', 'ChatPromptValue.to_messages()'],
    useCases: ['Consistent system prompts', 'Multi-language apps', 'Few-shot prompting'],
    inputs: [
      { name: 'language', label: 'Answer language', type: 'select', options: ['English', 'French', 'Spanish'], default: 'French' },
      { name: 'question', label: 'Question', type: 'text', default: 'Explain prompt templates' },
    ],
  },
  {
    id: 'lc-lcel', library: 'langchain', category: 'Composition (LCEL)', title: 'LCEL chains',
    tagline: 'prompt | model | parser: composition with the pipe operator',
    description: [
      'The LangChain Expression Language (LCEL) composes Runnables with |. The output of each step becomes the input of the next, producing a RunnableSequence.',
      'Every chain automatically gets invoke, stream, batch and their async versions, plus input/output schemas, tracing and the graph you see on the right (from chain.get_graph()).',
      'StrOutputParser turns the AIMessage into a plain string, the most common last step.',
    ],
    keyApis: ['Runnable | Runnable', 'RunnableSequence', 'StrOutputParser', 'chain.get_graph()'],
    useCases: ['Simple prompt → answer pipelines', 'Summarisation', 'Translation'],
    inputs: [
      { name: 'topic', label: 'Topic', type: 'text', default: 'vector databases' },
      { name: 'audience', label: 'Audience', type: 'text', default: 'new developer' },
    ],
  },
  {
    id: 'lc-parallel', library: 'langchain', category: 'Composition (LCEL)', title: 'Parallel, Passthrough & Lambda',
    tagline: 'Fan out to several branches at once and keep the input',
    description: [
      'RunnableParallel runs several Runnables on the same input concurrently and returns a dict of their outputs. A plain dict inside a chain is shorthand for it.',
      'RunnablePassthrough.assign(...) keeps the incoming dict and adds new keys. RunnableLambda wraps any Python function so it can sit in a chain.',
      'Here a summary chain, a keyword chain and a word counter run side by side. The self-check compares wall-clock time with the sum of the model calls to prove they overlapped.',
    ],
    keyApis: ['RunnableParallel', 'RunnablePassthrough.assign', 'RunnableLambda', 'CommaSeparatedListOutputParser'],
    useCases: ['Multi-aspect analysis', 'Parallel retrieval', 'Enriching inputs'],
    inputs: [{ name: 'text', label: 'Text to analyse', type: 'textarea', default: 'LangGraph lets developers model agents as graphs. Nodes do work, edges decide what runs next, and a checkpointer saves state so long-running workflows can pause and resume.' }],
  },
  {
    id: 'lc-structured', library: 'langchain', category: 'Models & prompts', title: 'Structured output',
    tagline: 'Get validated Pydantic objects instead of free text',
    description: [
      'model.with_structured_output(Schema) converts a Pydantic model (or TypedDict / JSON schema) into a tool definition, forces the model to call it, and parses the arguments back into a validated object.',
      'Literal fields constrain values to a fixed set; Field(description=…) tells the model what each field means. If the output does not validate you get an error, not silently wrong data.',
    ],
    keyApis: ['with_structured_output', 'Pydantic BaseModel', 'PydanticToolsParser'],
    useCases: ['Information extraction', 'Classification', 'Form filling', 'Routing decisions'],
    inputs: [{ name: 'email', label: 'Customer email', type: 'textarea', default: "Hi, I'm Dana. I was charged twice for order ORD-48213 and need a refund urgently!" }],
  },
  {
    id: 'lc-streaming', library: 'langchain', category: 'Composition (LCEL)', title: 'Streaming tokens',
    tagline: 'Show output as it is generated (live over Server-Sent Events)',
    description: [
      'chain.stream(...) yields chunks as soon as the model produces them. Parsers such as StrOutputParser stream too, so a whole chain streams end to end.',
      'This page receives every chunk from the backend over Server-Sent Events while the chain is still running, the same way a chat UI does. astream_events gives an even finer event feed (every step start/end).',
    ],
    keyApis: ['chain.stream()', 'chain.astream()', 'astream_events', 'AIMessageChunk'],
    useCases: ['Chat UIs', 'Long answers', 'Perceived latency'],
    inputs: [{ name: 'topic', label: 'Topic', type: 'text', default: 'why streaming improves UX' }],
    stream: true,
  },
  {
    id: 'lc-tools', library: 'langchain', category: 'Tools & agents', title: 'Tool calling',
    tagline: 'Let the model ask your code to do things',
    description: [
      '@tool turns a typed Python function and its docstring into a schema the model understands. model.bind_tools([...]) sends those schemas with every request.',
      'The model replies with tool_calls instead of text when it needs one. Your code runs each tool (tool.invoke(call) returns a ToolMessage) and sends the results back so the model can answer.',
      'This demo writes that loop by hand to show exactly what an agent does under the hood.',
    ],
    keyApis: ['@tool', 'bind_tools', 'AIMessage.tool_calls', 'ToolMessage'],
    useCases: ['APIs and databases', 'Calculations', 'Actions with side effects'],
    inputs: [{ name: 'question', label: 'Question', type: 'text', default: "What's the weather in Tokyo, and what is 23 * 19?" }],
  },
  {
    id: 'lc-agent', library: 'langchain', category: 'Tools & agents', title: 'Agents & middleware',
    tagline: 'create_agent: a production tool-calling loop with hooks',
    description: [
      'create_agent(model, tools, …) is LangChain 1.x’s standard agent. It is compiled to a LangGraph graph (look at the drawing), so it inherits streaming, persistence and human-in-the-loop.',
      'Middleware hooks into the loop: @before_model / @after_model run around each model call, @wrap_tool_call wraps tool execution, @dynamic_prompt computes the system prompt per call. Built-ins include ModelCallLimitMiddleware, SummarizationMiddleware, HumanInTheLoopMiddleware, PIIMiddleware and ModelFallbackMiddleware.',
    ],
    keyApis: ['create_agent', '@before_model', '@wrap_tool_call', '@dynamic_prompt', 'ModelCallLimitMiddleware'],
    useCases: ['Assistants with tools', 'Guardrails', 'Cost limits', 'Audit logging'],
    inputs: [{ name: 'question', label: 'Question', type: 'text', default: 'What is the weather in Paris? Also compute 128 / 4.' }],
  },
  {
    id: 'lc-splitters', library: 'langchain', category: 'Retrieval', title: 'Documents & text splitters',
    tagline: 'Cut long documents into retrievable chunks',
    description: [
      'A Document is page_content plus metadata. Loaders (PDF, web, Notion, …) produce Documents; splitters cut them into chunks small enough to embed and to fit in a prompt.',
      'RecursiveCharacterTextSplitter tries paragraph, then line, then word boundaries so chunks stay coherent. chunk_overlap repeats a little text between neighbours so facts on a boundary are not lost. MarkdownHeaderTextSplitter splits on headings and keeps them as metadata.',
      'Change the sizes and watch the coloured chunks re-flow over the source text.',
    ],
    keyApis: ['Document', 'RecursiveCharacterTextSplitter', 'CharacterTextSplitter', 'MarkdownHeaderTextSplitter'],
    useCases: ['RAG ingestion', 'Summarising long files', 'Search indexing'],
    inputs: [
      { name: 'splitter', label: 'Splitter', type: 'select', options: ['recursive', 'character', 'markdown'], default: 'recursive' },
      { name: 'chunk_size', label: 'chunk_size', type: 'number', default: 220, min: 60, max: 1000 },
      { name: 'chunk_overlap', label: 'chunk_overlap', type: 'number', default: 40, min: 0, max: 200 },
    ],
  },
  {
    id: 'lc-rag', library: 'langchain', category: 'Retrieval', title: 'Retrieval-augmented generation',
    tagline: 'Answer from your own documents',
    description: [
      'RAG has two phases. Indexing: split documents, embed each chunk into a vector and store it. Query: embed the question, retrieve the most similar chunks, and give them to the model as context.',
      'The chain {"context": retriever | format_docs, "question": RunnablePassthrough()} | prompt | model | parser runs retrieval and passes the question through in parallel.',
      'This lab uses InMemoryVectorStore and a tiny offline hashing embedding so it runs without any API. In production, swap in a real embedding model and a vector database (pgvector, Pinecone, Chroma, …): the chain stays the same.',
    ],
    keyApis: ['Embeddings', 'InMemoryVectorStore', 'as_retriever()', 'similarity_search_with_score'],
    useCases: ['Docs Q&A', 'Support bots', 'Internal knowledge bases'],
    inputs: [{ name: 'question', label: 'Question about the handbook', type: 'select', options: ['How many vacation days do I get?', 'What laptop can I choose?', 'How long is parental leave?', 'What are the core working hours?', 'How fast must I report a lost device?'], default: 'How many vacation days do I get?' }],
  },
  {
    id: 'lc-memory', library: 'langchain', category: 'Tools & agents', title: 'Short-term memory',
    tagline: 'Conversation history per thread with a checkpointer',
    description: [
      'In LangChain 1.x an agent remembers a conversation through a LangGraph checkpointer: pass checkpointer=InMemorySaver() (or Postgres/SQLite/Redis savers) and a thread_id in the config.',
      'Each turn the saved messages are loaded, the new message is appended, and the result is saved again. Different session names are different threads with separate memories.',
      'trim_messages (or SummarizationMiddleware) keeps long histories inside the context window. The older RunnableWithMessageHistory is deprecated in favour of this.',
    ],
    keyApis: ['create_agent(checkpointer=…)', 'configurable.thread_id', 'get_state', 'trim_messages'],
    useCases: ['Chatbots', 'Multi-turn assistants', 'Per-user sessions'],
    inputs: [
      { name: 'session', label: 'Session (thread)', type: 'text', default: 'demo' },
      { name: 'message', label: 'Message', type: 'text', default: 'Hi, my name is Ada.' },
    ],
    actions: [{ label: 'Send message', inputs: { action: 'send' } }, { label: 'Clear session', inputs: { action: 'clear' }, tone: 'ghost' }],
  },
  {
    id: 'lc-reliability', library: 'langchain', category: 'Production', title: 'Retries, fallbacks & caching',
    tagline: 'Survive flaky APIs and avoid paying twice',
    description: [
      '.with_retry() re-runs a step on failure with optional exponential backoff. Here a lookup fails twice with 503 and succeeds on the third try.',
      '.with_fallbacks([...]) tries alternatives when a Runnable raises, for example a second model provider during an outage.',
      'Passing cache=InMemoryCache() to a model (or set_llm_cache globally; Redis/SQLite caches exist) returns identical prompts from the cache: the second run skips the model completely.',
    ],
    keyApis: ['.with_retry()', '.with_fallbacks()', 'InMemoryCache', 'set_llm_cache'],
    useCases: ['Rate limits', 'Provider outages', 'Cost savings'],
    inputs: [{ name: 'question', label: 'Question', type: 'text', default: 'What does with_fallbacks do?' }],
  },
  {
    id: 'lc-batch', library: 'langchain', category: 'Production', title: 'Batch & concurrency',
    tagline: 'Process many inputs at once',
    description: [
      'chain.batch(inputs) runs a chain over a list concurrently (a thread pool for sync code, asyncio for abatch) and returns results in input order.',
      'config={"max_concurrency": n} caps parallel requests so you stay inside provider rate limits. Set it to 1 to see the batch fall back to sequential speed.',
    ],
    keyApis: ['chain.batch()', 'chain.abatch()', 'max_concurrency', 'batch_as_completed'],
    useCases: ['Bulk classification', 'Evaluations', 'Back-filling data'],
    inputs: [{ name: 'max_concurrency', label: 'max_concurrency', type: 'select', options: [1, 2, 3, 6], default: 6 }],
  },
  {
    id: 'lc-callbacks', library: 'langchain', category: 'Production', title: 'Callbacks & tracing',
    tagline: 'See every step: custom handlers and LangSmith',
    description: [
      'Every Runnable emits callback events: chain start/end, chat model start, new token, tool start/end, retriever end, errors. A BaseCallbackHandler subclass receives them. This lab’s own animations are built that way.',
      'with_config(run_name=…, tags=[…], metadata={…}) labels runs. Set LANGSMITH_TRACING=true and LANGSMITH_API_KEY in .env and every run is also sent to LangSmith for debugging and evaluation, with no code changes.',
    ],
    keyApis: ['BaseCallbackHandler', 'config["callbacks"]', 'with_config(run_name, tags, metadata)', 'LangSmith'],
    useCases: ['Debugging', 'Token accounting', 'Observability'],
    inputs: [{ name: 'thing', label: 'Benefit of…', type: 'text', default: 'observability' }],
  },

  // ---- LangGraph ------------------------------------------------------------------------------
  {
    id: 'lg-basics', library: 'langgraph', category: 'Graph fundamentals', title: 'StateGraph basics',
    tagline: 'State, nodes, edges, compile, invoke',
    description: [
      'A LangGraph app is a StateGraph: a typed state (TypedDict, dataclass or Pydantic), nodes that are plain functions taking the state and returning a partial update, and edges that say which node runs next.',
      'START and END are the entry and exit points. compile() validates the graph and returns a Runnable with invoke, stream and batch.',
      'The timeline below shows the update each node returned and how they merge into the final state.',
    ],
    keyApis: ['StateGraph(State)', 'add_node', 'add_edge(START, …)', 'compile()', 'stream_mode="updates"'],
    useCases: ['Deterministic pipelines', 'ETL with LLM steps', 'Workflow skeletons'],
    inputs: [{ name: 'text', label: 'Input text', type: 'text', default: 'graphs are just functions and edges' }],
  },
  {
    id: 'lg-reducers', library: 'langgraph', category: 'Graph fundamentals', title: 'State reducers',
    tagline: 'How node updates are merged into state',
    description: [
      'By default a node’s update overwrites the key. Annotate a key with a reducer to merge instead: Annotated[list, operator.add] appends, Annotated[int, operator.add] sums.',
      'add_messages is the reducer behind MessagesState: it appends new messages but replaces a message that has the same id, which is how edits and streaming updates work.',
      'worker_a and worker_b run in the same super-step (in parallel). Without reducers their writes to the same key would conflict; with them, both are kept.',
    ],
    keyApis: ['Annotated[T, reducer]', 'operator.add', 'add_messages', 'fan-out / fan-in edges'],
    useCases: ['Accumulating results', 'Chat histories', 'Parallel branches'],
    inputs: [{ name: 'start_total', label: 'Initial total', type: 'number', default: 1, min: -100, max: 100 }],
  },
  {
    id: 'lg-conditional', library: 'langgraph', category: 'Agents & control flow', title: 'Conditional edges',
    tagline: 'Let a function (or an LLM) choose the next node',
    description: [
      'add_conditional_edges(source, route_fn) calls route_fn(state) after the source node and goes to the node it returns. A Literal return type lets LangGraph draw the possible branches (the dashed edges).',
      'Here an LLM classifies the message and the router sends it to the billing, technical or general team. Try a message about an error, or about a refund.',
    ],
    keyApis: ['add_conditional_edges', 'Literal[…] route return type', 'dashed = conditional'],
    useCases: ['Intent routing', 'Escalation paths', 'Guardrails'],
    inputs: [{ name: 'question', label: 'Customer message', type: 'select', options: ['I was charged twice, can I get a refund?', 'The API returns an error when I log in', 'What are your opening hours?'], default: 'I was charged twice, can I get a refund?' }],
  },
  {
    id: 'lg-loops', library: 'langgraph', category: 'Agents & control flow', title: 'Cycles & loops',
    tagline: 'Iterate until good enough (writer ↔ critic)',
    description: [
      'Unlike a chain, a graph can loop. A conditional edge from review back to write repeats the cycle until the critic’s score passes the threshold or the iteration cap is reached.',
      'recursion_limit in the config is a safety net: LangGraph stops a run that takes too many super-steps. The critic uses structured output (a Review schema) so the loop condition is reliable.',
    ],
    keyApis: ['cycles via conditional edges', 'recursion_limit', 'with_structured_output'],
    useCases: ['Self-correction', 'Code generation + tests', 'Reflection agents'],
    inputs: [
      { name: 'topic', label: 'Tagline topic', type: 'text', default: 'a coffee shop on Mars' },
      { name: 'threshold', label: 'Score threshold', type: 'number', default: 8, min: 1, max: 10 },
      { name: 'max_iterations', label: 'Max iterations', type: 'number', default: 4, min: 1, max: 6 },
    ],
  },
  {
    id: 'lg-react', library: 'langgraph', category: 'Agents & control flow', title: 'Tool-calling agent from scratch',
    tagline: 'agent ⇄ tools: the ReAct loop as a graph',
    description: [
      'The classic agent is two nodes: agent calls the model with tools bound; tools (prebuilt ToolNode) executes every tool call in the last message. tools_condition routes to tools when there are tool calls, otherwise to END.',
      'MessagesState provides a messages key with the add_messages reducer, so each node simply returns new messages. This is what create_agent builds for you, minus the middleware.',
    ],
    keyApis: ['MessagesState', 'ToolNode', 'tools_condition', 'bind_tools'],
    useCases: ['Custom agents', 'Tool orchestration', 'Full control over the loop'],
    inputs: [{ name: 'question', label: 'Question', type: 'text', default: "What's the weather in Denver and what is (12 + 30) * 2?" }],
  },
  {
    id: 'lg-checkpoint', library: 'langgraph', category: 'Persistence & humans', title: 'Persistence & threads',
    tagline: 'Checkpoint state after every step',
    description: [
      'compile(checkpointer=…) saves a snapshot of the state after every super-step, keyed by the thread_id in the config. InMemorySaver is for demos; PostgresSaver, SqliteSaver and RedisSaver persist across restarts.',
      'get_state(config) returns the latest StateSnapshot (values, next nodes, metadata). get_state_history(config) lists every checkpoint, newest first. Send several messages, then switch thread to start a separate conversation.',
    ],
    keyApis: ['compile(checkpointer=InMemorySaver())', 'thread_id', 'get_state', 'get_state_history'],
    useCases: ['Conversation memory', 'Fault tolerance', 'Resumable jobs'],
    inputs: [
      { name: 'thread', label: 'Thread id', type: 'select', options: ['thread-1', 'thread-2', 'thread-3'], default: 'thread-1' },
      { name: 'message', label: 'Message', type: 'text', default: 'Hello there!' },
    ],
  },
  {
    id: 'lg-hitl', library: 'langgraph', category: 'Persistence & humans', title: 'Human-in-the-loop',
    tagline: 'Pause with interrupt(), resume with Command(resume=…)',
    description: [
      'interrupt(payload) inside a node pauses the whole graph and returns the payload to the caller. The state is checkpointed, so the pause can last seconds or weeks.',
      'Resume by invoking the same thread with Command(resume=value): the node re-runs and interrupt() returns that value. Here a reviewer approves, edits or rejects a refund before it is issued.',
      'For agents, HumanInTheLoopMiddleware does the same for selected tool calls.',
    ],
    keyApis: ['interrupt()', 'Command(resume=…)', 'StateSnapshot.interrupts', 'HumanInTheLoopMiddleware'],
    useCases: ['Approvals', 'Editing drafts', 'Sensitive actions (payments, emails)'],
    inputs: [{ name: 'request', label: 'Refund request', type: 'text', default: 'Customer asks for a $120 refund for a broken grinder.' }],
    actions: [{ label: 'Start refund workflow', inputs: { action: 'start' } }],
  },
  {
    id: 'lg-timetravel', library: 'langgraph', category: 'Persistence & humans', title: 'Time travel',
    tagline: 'Replay from any checkpoint, or fork with edited state',
    description: [
      'Because every step is checkpointed, you can go back. Pick a checkpoint from get_state_history, call update_state(that_config, changes) to create a new branch, then invoke(None, new_config) to continue from there.',
      'Only the nodes after the checkpoint re-run; the original timeline stays in the history. This is how you debug agents ("what if the model had chosen differently?") and implement undo.',
    ],
    keyApis: ['get_state_history', 'update_state', 'invoke(None, checkpoint_config)', 'parent_config'],
    useCases: ['Debugging agents', 'What-if exploration', 'Undo / branching UIs'],
    inputs: [
      { name: 'topic', label: 'Original topic', type: 'text', default: 'robot' },
      { name: 'new_topic', label: 'Fork with topic', type: 'text', default: 'penguin' },
    ],
  },
  {
    id: 'lg-streaming', library: 'langgraph', category: 'Streaming & scale', title: 'Stream modes',
    tagline: 'values, updates, custom and messages, live over SSE',
    description: [
      'graph.stream(..., stream_mode=…) chooses what you receive: "values" is the full state after each step, "updates" only what each node changed, "messages" streams LLM tokens from inside any node, and "custom" carries anything a node sends with get_stream_writer().',
      'Pass a list to get several modes at once, as here. Each lane below fills in live as the backend streams events.',
    ],
    keyApis: ['stream_mode=[…]', 'get_stream_writer()', '"messages" token stream', 'subgraphs=True'],
    useCases: ['Progress bars', 'Token-by-token chat', 'Live dashboards'],
    inputs: [{ name: 'topic', label: 'Topic', type: 'text', default: 'streaming' }],
    stream: true,
  },
  {
    id: 'lg-send', library: 'langgraph', category: 'Streaming & scale', title: 'Map-reduce with Send',
    tagline: 'Fan out to a dynamic number of parallel workers',
    description: [
      'When you only know at run time how many branches you need, return a list of Send(node, payload) from a conditional edge. Each Send starts a separate copy of the node with its own input, all in parallel.',
      'A reducer (operator.add) collects every worker’s result, and the next node runs once they have all finished.',
    ],
    keyApis: ['Send(node, state)', 'add_conditional_edges(START, fan_out)', 'operator.add reducer'],
    useCases: ['Summarising many documents', 'Parallel research', 'Batch evaluations'],
    inputs: [{ name: 'topics', label: 'Topics (comma separated)', type: 'text', default: 'octopus, volcano, honey, saturn' }],
  },
  {
    id: 'lg-subgraphs', library: 'langgraph', category: 'Streaming & scale', title: 'Subgraphs',
    tagline: 'Compose graphs from graphs',
    description: [
      'A compiled graph can be added as a node of another graph. Keys the two states share flow in and out automatically; for different schemas, call the subgraph from a node function and map the state yourself.',
      'stream(..., subgraphs=True) reports the namespace of each event, so you can see inner steps. get_graph(xray=True) draws the subgraph’s nodes inline.',
    ],
    keyApis: ['add_node("name", compiled_graph)', 'subgraphs=True', 'get_graph(xray=True)'],
    useCases: ['Multi-agent teams', 'Reusable components', 'Separating concerns'],
    inputs: [{ name: 'question', label: 'Research question', type: 'text', default: 'Why do agents need state?' }],
  },
  {
    id: 'lg-command', library: 'langgraph', category: 'Agents & control flow', title: 'Command & handoffs',
    tagline: 'Update state and choose the next node in one return',
    description: [
      'A node can return Command(goto="node", update={...}) instead of a plain dict. Routing then lives inside the node, which suits agent handoffs: triage hands off to tech_agent, which can hand off again to billing_agent.',
      'Annotate the return type as Command[Literal[…]] so LangGraph knows the possible destinations and can draw them. Command(graph=Command.PARENT) hands off to a node in the parent graph.',
    ],
    keyApis: ['Command(goto, update)', 'Command[Literal[…]]', 'Command.PARENT'],
    useCases: ['Multi-agent handoffs', 'Swarm architectures', 'Dynamic routing'],
    inputs: [{ name: 'message', label: 'Message', type: 'select', options: ['The app crashes when I try to upgrade my plan', 'The app crashes on startup', 'I need a refund for my invoice'], default: 'The app crashes when I try to upgrade my plan' }],
  },
  {
    id: 'lg-store', library: 'langgraph', category: 'Persistence & humans', title: 'Long-term memory (Store)',
    tagline: 'Memories that outlive a single thread',
    description: [
      'A checkpointer remembers one thread. A Store remembers across threads: compile(store=…) and nodes reach it through runtime.store, organised by namespaces such as ("memories", user_id).',
      'store.put saves a JSON value; store.search(namespace, query=…) does semantic search when the store has an embedding index. Save a fact, then ask about it from a brand-new thread.',
    ],
    keyApis: ['InMemoryStore(index=…)', 'runtime.store.put / search', 'namespaces', 'context_schema'],
    useCases: ['User preferences', 'Personalisation', 'Facts learned over time'],
    inputs: [
      { name: 'user_id', label: 'User', type: 'select', options: ['ada', 'grace', 'linus'], default: 'ada' },
      { name: 'message', label: 'Message (start with "Remember" to save)', type: 'select', options: ['Remember that I prefer oat milk lattes', 'Remember that my favourite city is Lisbon', 'What coffee do I like?', 'Which city is my favourite?'], default: 'Remember that I prefer oat milk lattes' },
    ],
    actions: [{ label: 'Send in a new thread' }],
  },
  {
    id: 'lg-functional', library: 'langgraph', category: 'Alternative APIs', title: 'Functional API',
    tagline: '@entrypoint and @task: LangGraph without drawing a graph',
    description: [
      'The Functional API gives you persistence, streaming and interrupts with ordinary Python control flow. @entrypoint marks the workflow; @task marks units of work whose results are checkpointed.',
      'Calling a task returns a future, so starting several before calling .result() runs them in parallel. Use it when loops and ifs read better than nodes and edges.',
    ],
    keyApis: ['@entrypoint(checkpointer=…)', '@task', 'future.result()'],
    useCases: ['Adding persistence to existing code', 'Simple parallel workflows'],
    inputs: [{ name: 'topics', label: 'Topics (comma separated)', type: 'text', default: 'comets, coral, crows' }],
  },
  {
    id: 'lg-policies', library: 'langgraph', category: 'Alternative APIs', title: 'Node retries & caching',
    tagline: 'RetryPolicy and CachePolicy per node',
    description: [
      'add_node(..., retry_policy=RetryPolicy(max_attempts=3)) retries a failing node with backoff. Only that node re-runs, not the whole graph.',
      'add_node(..., cache_policy=CachePolicy(ttl=120)) plus compile(cache=InMemoryCache()) caches a node’s result keyed on its input, so the second run skips the slow node entirely.',
    ],
    keyApis: ['RetryPolicy', 'CachePolicy', 'compile(cache=InMemoryCache())'],
    useCases: ['Flaky APIs', 'Expensive steps', 'Idempotent pipelines'],
    inputs: [{ name: 'query', label: 'Query', type: 'text', default: 'weather in Austin' }],
  },
];

export const INFO_BY_ID: Record<string, DemoInfo> = Object.fromEntries(DEMO_INFO.map((d) => [d.id, d]));

export function defaultInputs(info: DemoInfo): Record<string, unknown> {
  return Object.fromEntries(info.inputs.map((i) => [i.name, i.default]));
}
