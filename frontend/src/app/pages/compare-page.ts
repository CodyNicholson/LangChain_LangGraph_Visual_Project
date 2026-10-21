import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CodeBlock } from '../components/code-block';
import { PROS_CONS, QUESTIONS, SCENARIOS } from '../data/guides';

const LC_AGENT = `from langchain.agents import create_agent

agent = create_agent(
    "anthropic:claude-sonnet-5-5",
    tools=[get_weather, calculator],
    system_prompt="You are a helpful assistant.",
)
agent.invoke({"messages": [("user", "Weather in Oslo?")]})`;

const LG_AGENT = `from langgraph.graph import StateGraph, MessagesState, START
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.checkpoint.memory import InMemorySaver

model = init_chat_model("anthropic:claude-sonnet-5-5").bind_tools(TOOLS)

def agent(state: MessagesState):
    return {"messages": [model.invoke(state["messages"])]}

builder = StateGraph(MessagesState)
builder.add_node("agent", agent)
builder.add_node("tools", ToolNode(TOOLS))
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", tools_condition)
builder.add_edge("tools", "agent")
graph = builder.compile(checkpointer=InMemorySaver())
graph.invoke({"messages": [("user", "Weather in Oslo?")]},
             {"configurable": {"thread_id": "1"}})`;

@Component({
  selector: 'app-compare-page',
  imports: [CodeBlock, RouterLink],
  template: `
    <article class="demo">
      <header class="demo-head">
        <span class="chip">Comparison</span>
        <h2>LangChain vs LangGraph: pros and cons</h2>
        <p class="tagline">They solve different layers of the problem: LangChain standardises the pieces, LangGraph controls how they run.</p>
      </header>

      <div class="duo">
        @for (lib of libs; track lib.id) {
          <section class="card procon" [class.lib-langgraph]="lib.id === 'langgraph'">
            <h3><span class="dot" [class]="lib.id === 'langchain' ? 'dot-lc' : 'dot-lg'"></span>{{ lib.name }} <span class="muted">· {{ data[lib.id].tagline }}</span></h3>
            <h4 class="ok">Pros</h4>
            @for (p of data[lib.id].pros; track p.title) {
              <div class="pc pc-pro" [style.animation-delay.ms]="$index * 90"><b>+ {{ p.title }}</b><span>{{ p.detail }}</span></div>
            }
            <h4 class="bad">Cons</h4>
            @for (c of data[lib.id].cons; track c.title) {
              <div class="pc pc-con" [style.animation-delay.ms]="$index * 90 + 400"><b>− {{ c.title }}</b><span>{{ c.detail }}</span></div>
            }
          </section>
        }
      </div>

      <section class="card">
        <h3>Which should I use?</h3>
        <div class="decide">
          <div class="questions">
            @for (q of questions; track q.id) {
              <label class="q"><input type="checkbox" [checked]="picked().has(q.id)" (change)="toggle(q.id)" /> {{ q.text }}</label>
            }
          </div>
          <div class="verdict" [class.verdict-lg]="score() > 0" [class.verdict-lc]="score() < 0">
            <div class="meter"><span class="meter-needle" [style.left.%]="50 + Math.max(-48, Math.min(48, score() * 6))"></span></div>
            <div class="meter-labels"><span>LangChain</span><span>Both</span><span>LangGraph</span></div>
            <p class="verdict-text">{{ verdict() }}</p>
          </div>
        </div>
      </section>

      <section class="card">
        <h3>Typical scenarios</h3>
        <table class="table">
          <thead><tr><th>You need</th><th>Reach for</th><th>Why</th></tr></thead>
          <tbody>
            @for (s of scenarios; track s.need) {
              <tr><td>{{ s.need }}</td><td><span class="chip" [class.chip-lg]="s.pick === 'LangGraph'" [class.chip-both]="s.pick === 'Both'">{{ s.pick }}</span></td><td class="muted">{{ s.why }}</td></tr>
            }
          </tbody>
        </table>
      </section>

      <section class="card">
        <h3>The same tool-calling agent, two ways</h3>
        <div class="duo">
          <div><h4>LangChain: create_agent (≈8 lines)</h4><app-code-block [code]="lcAgent" name="agent_langchain.py" /></div>
          <div><h4>LangGraph: explicit graph (≈18 lines, full control)</h4><app-code-block [code]="lgAgent" name="agent_langgraph.py" /></div>
        </div>
        <p class="muted mt">Run both: <a routerLink="/demo/lc-agent">create_agent demo</a> · <a routerLink="/demo/lg-react">agent-from-scratch demo</a>.</p>
      </section>

      <section class="card">
        <h3>At a glance</h3>
        <table class="table">
          <thead><tr><th></th><th>LangChain</th><th>LangGraph</th></tr></thead>
          <tbody>
            @for (row of glance; track row[0]) { <tr><td><b>{{ row[0] }}</b></td><td>{{ row[1] }}</td><td>{{ row[2] }}</td></tr> }
          </tbody>
        </table>
      </section>
    </article>
  `,
})
export class ComparePage {
  readonly Math = Math;
  readonly data = PROS_CONS;
  readonly scenarios = SCENARIOS;
  readonly questions = QUESTIONS;
  readonly lcAgent = LC_AGENT;
  readonly lgAgent = LG_AGENT;
  readonly libs = [{ id: 'langchain' as const, name: 'LangChain' }, { id: 'langgraph' as const, name: 'LangGraph' }];
  readonly glance = [
    ['Abstraction level', 'High: components and ready-made agents', 'Low: state machine / graph runtime'],
    ['Control flow', 'Linear chains (DAGs), agent loop inside create_agent', 'Any graph: cycles, branches, fan-out, handoffs'],
    ['State', 'Messages passed along a chain', 'Typed shared state with reducers'],
    ['Persistence', 'Via a LangGraph checkpointer in create_agent', 'Checkpointers built in: threads, time travel'],
    ['Human-in-the-loop', 'HumanInTheLoopMiddleware', 'interrupt() anywhere + Command(resume)'],
    ['Streaming', 'stream / astream_events', 'values, updates, messages, custom, subgraphs'],
    ['Integrations', 'Hundreds of providers', 'Uses LangChain’s, or none'],
    ['Learning curve', 'Gentle', 'Steeper'],
  ];

  readonly picked = signal(new Set<string>());
  readonly score = computed(() => QUESTIONS.filter((q) => this.picked().has(q.id)).reduce((a, q) => a + q.weight, 0));
  readonly verdict = computed(() => {
    const s = this.score();
    if (!this.picked().size) return 'Tick what your project needs.';
    if (s >= 3) return 'LangGraph: you need explicit control flow, durability or humans in the loop. Use LangChain components inside its nodes.';
    if (s <= -2) return 'LangChain: chains, RAG and create_agent will get you there with less code.';
    return 'Both: start with LangChain components and create_agent; drop down to a custom LangGraph graph where you need more control.';
  });

  toggle(id: string): void {
    this.picked.update((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
}
