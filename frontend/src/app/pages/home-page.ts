import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../api.service';
import { AnimStep } from '../components/graph-layout';
import { GraphView } from '../components/graph-view';
import { DEMO_INFO, LANGCHAIN_CATEGORIES, LANGGRAPH_CATEGORIES } from '../data/catalog';
import { GraphData } from '../models';

const CHAIN: GraphData = {
  nodes: [{ id: 'in', label: 'input dict' }, { id: 'prompt', label: 'ChatPromptTemplate' }, { id: 'model', label: 'ChatAnthropic', kind: 'llm' },
    { id: 'parser', label: 'StrOutputParser' }, { id: 'out', label: 'str' }],
  edges: [{ source: 'in', target: 'prompt', conditional: false }, { source: 'prompt', target: 'model', conditional: false },
    { source: 'model', target: 'parser', conditional: false }, { source: 'parser', target: 'out', conditional: false }],
  mermaid: '',
};
const GRAPH: GraphData = {
  nodes: [{ id: '__start__', label: '__start__' }, { id: 'agent', label: 'agent' }, { id: 'tools', label: 'tools' },
    { id: 'human_review', label: 'human_review' }, { id: '__end__', label: '__end__' }],
  edges: [{ source: '__start__', target: 'agent', conditional: false }, { source: 'agent', target: 'tools', conditional: true },
    { source: 'tools', target: 'agent', conditional: false }, { source: 'agent', target: 'human_review', conditional: true },
    { source: 'human_review', target: '__end__', conditional: false }],
  mermaid: '',
};
const step = (nodeId: string, caption: string): AnimStep => ({ nodeId, captions: [caption], kind: 'node' });
const CHAIN_STEPS = [step('in', '{"topic": "graphs"}'), step('prompt', 'format messages'), step('model', 'generate'), step('parser', 'AIMessage → str'), step('out', '"Graphs are…"')];
const GRAPH_STEPS = [step('__start__', 'messages'), step('agent', 'model wants a tool'), step('tools', 'run get_weather'), step('agent', 'needs another tool'),
  step('tools', 'run calculator'), step('agent', 'ready to answer'), step('human_review', 'interrupt(): wait for approval'), step('__end__', 'approved')];

@Component({
  selector: 'app-home-page',
  imports: [GraphView, RouterLink],
  template: `
    <section class="hero">
      <div class="hero-text">
        <span class="chip">Interactive lab</span>
        <h2>LangChain &amp; LangGraph, visually</h2>
        <p class="tagline">Every feature as a live demo running real Python in Docker: animated graphs replay the actual execution trace, and the code on each page is the code that ran.</p>
        <div class="actions">
          <a class="btn btn-primary" routerLink="/start/langchain">Create a LangChain project</a>
          <a class="btn btn-lg" routerLink="/start/langgraph">Create a LangGraph project</a>
          <a class="btn btn-ghost" routerLink="/compare">Pros &amp; cons →</a>
        </div>
        <p class="muted mt">
          @if (api.config(); as c) {
            langchain {{ c.versions['langchain'] }} · langgraph {{ c.versions['langgraph'] }} · langchain-core {{ c.versions['langchain-core'] }} ·
            {{ c.liveAvailable ? 'Claude available (toggle "Live" in the header)' : 'offline scripted model (add ANTHROPIC_API_KEY to .env for Claude)' }}
          }
        </p>
      </div>
    </section>

    <div class="duo">
      <section class="card">
        <div class="card-title-row"><h3><span class="dot dot-lc"></span>LangChain: compose components</h3></div>
        <p class="muted">A chain is a straight pipeline. Data flows once from input to output.</p>
        <app-graph-view [graph]="chain" [steps]="chainSteps" [runKey]="tick()" library="langchain" [showSteps]="false" />
      </section>
      <section class="card">
        <div class="card-title-row"><h3><span class="dot dot-lg"></span>LangGraph: orchestrate state</h3></div>
        <p class="muted">A graph can loop, branch and pause for a human, with state saved at every step.</p>
        <app-graph-view [graph]="graph" [steps]="graphSteps" [runKey]="tick()" library="langgraph" [showSteps]="false" />
      </section>
    </div>

    <section class="card">
      <h3>How they fit together</h3>
      <div class="stack">
        @for (layer of stack; track layer.name; let i = $index) {
          <div class="stack-layer" [class]="'stack-' + layer.cls" [style.animation-delay.ms]="i * 120">
            <b>{{ layer.name }}</b><span>{{ layer.text }}</span>
          </div>
        }
      </div>
      <p class="muted mt">LangChain 1.x’s <code>create_agent</code> is itself compiled to a LangGraph graph, so the two are layers of one stack rather than rivals. LangGraph also works on its own, with any Python code.</p>
    </section>

    <div class="duo">
      @for (lib of libs; track lib.id) {
        <section class="card feature-map">
          <h3><span class="dot" [class]="lib.id === 'langchain' ? 'dot-lc' : 'dot-lg'"></span>{{ lib.name }} features</h3>
          @for (cat of lib.categories; track cat) {
            <div class="fm-group">
              <div class="nav-heading">{{ cat }}</div>
              <div class="fm-items">
                @for (d of byCategory(lib.id, cat); track d.id) {
                  <a [routerLink]="['/demo', d.id]" class="fm-item">
                    <span>{{ d.title }}</span>
                    @switch (api.suiteStatus()[d.id]) { @case ('pass') { <span class="ok">✓</span> } @case ('fail') { <span class="bad">✗</span> } }
                  </a>
                }
              </div>
            </div>
          }
        </section>
      }
    </div>

    <section class="card">
      <h3>Run this lab</h3>
      <ol class="run-steps">
        <li><code>cp .env.example .env</code> and optionally set <code>ANTHROPIC_API_KEY</code> (without it every demo uses the offline scripted model).</li>
        <li><code>docker network create tunnel-net</code> once (the compose file joins it), then <code>docker compose up -d --build</code>.</li>
        <li>Open <code>http://localhost:3000</code>.</li>
      </ol>
      <p class="muted"><a routerLink="/suite">Run every demo as a self-test →</a></p>
    </section>
  `,
})
export class HomePage implements OnDestroy {
  readonly api = inject(ApiService);
  readonly chain = CHAIN;
  readonly graph = GRAPH;
  readonly chainSteps = CHAIN_STEPS;
  readonly graphSteps = GRAPH_STEPS;
  readonly tick = signal(1);
  private readonly timer = setInterval(() => this.tick.update((t) => t + 1), 9000);

  readonly stack = [
    { name: 'Your application', text: 'API, UI, business logic', cls: 'app' },
    { name: 'LangSmith', text: 'tracing, evaluation, prompt management, deployment (optional, hosted)', cls: 'ls' },
    { name: 'LangGraph', text: 'runtime: state, nodes & edges, checkpoints, interrupts, streaming, Store', cls: 'lg' },
    { name: 'LangChain', text: 'components: models, prompts, tools, retrievers, parsers, create_agent + middleware', cls: 'lc' },
    { name: 'Providers', text: 'Claude, OpenAI, Gemini, Ollama · vector DBs · loaders · APIs', cls: 'prov' },
  ];
  readonly libs = [
    { id: 'langchain', name: 'LangChain', categories: LANGCHAIN_CATEGORIES },
    { id: 'langgraph', name: 'LangGraph', categories: LANGGRAPH_CATEGORIES },
  ];
  private readonly available = computed(() => new Set(this.api.demos().map((d) => d.id)));

  byCategory(library: string, category: string) {
    return DEMO_INFO.filter((d) => d.library === library && d.category === category && (this.available().size === 0 || this.available().has(d.id)));
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
