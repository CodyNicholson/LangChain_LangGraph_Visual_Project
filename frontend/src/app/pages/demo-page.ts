import { JsonPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../api.service';
import { CodeBlock } from '../components/code-block';
import { buildSteps } from '../components/graph-layout';
import { GraphView } from '../components/graph-view';
import { OutputView } from '../components/output-view';
import { TraceView } from '../components/trace-view';
import { INFO_BY_ID, defaultInputs } from '../data/catalog';
import { DemoAction, DemoResult, TimelineEvent } from '../models';

interface DemoState {
  inputs: Record<string, unknown>;
  result: DemoResult | null;
}

/** Survives navigating between demos (component instances do not). */
const SAVED = new Map<string, DemoState>();

type Tab = 'code' | 'trace' | 'mermaid' | 'raw';

@Component({
  selector: 'app-demo-page',
  imports: [GraphView, OutputView, TraceView, CodeBlock, JsonPipe, RouterLink],
  template: `
    @if (info(); as d) {
      <article class="demo" [class.lib-langgraph]="d.library === 'langgraph'">
        <header class="demo-head">
          <span class="chip" [class.chip-lg]="d.library === 'langgraph'">{{ d.library === 'langchain' ? 'LangChain' : 'LangGraph' }} · {{ d.category }}</span>
          <h2>{{ d.title }}</h2>
          <p class="tagline">{{ d.tagline }}</p>
        </header>

        <div class="demo-intro">
          <section class="card explain">
            <h3>How it works</h3>
            @for (p of d.description; track $index) { <p>{{ p }}</p> }
            <div class="api-list">
              <span class="muted">Key APIs</span>
              @for (k of d.keyApis; track k) { <code class="api">{{ k }}</code> }
            </div>
            <div class="use-cases">
              <span class="muted">Used for</span>
              @for (u of d.useCases; track u) { <span class="chip chip-soft">{{ u }}</span> }
            </div>
          </section>

          <section class="card">
            <div class="card-title-row">
              <h3>{{ d.library === 'langgraph' ? 'Graph (compiled.get_graph())' : 'Flow (Runnable.get_graph())' }}</h3>
              <button type="button" class="btn btn-ghost btn-small" (click)="runKey.set(runKey() + 1)" [disabled]="!result()">↻ Replay</button>
            </div>
            <app-graph-view [graph]="graph()" [steps]="steps()" [runKey]="runKey()" [library]="d.library" />
          </section>
        </div>

        <section class="card controls">
          @if (d.inputs.length) {
            <div class="inputs">
              @for (i of d.inputs; track i.name) {
                <label class="input" [class.input-wide]="i.type === 'textarea' || i.type === 'text'">
                  <span>{{ i.label }}</span>
                  @switch (i.type) {
                    @case ('select') {
                      <select [value]="inputs()[i.name]" (change)="setInput(i.name, $any($event.target).value)">
                        @for (o of i.options; track o) { <option [value]="o" [selected]="o == inputs()[i.name]">{{ o }}</option> }
                      </select>
                    }
                    @case ('textarea') { <textarea rows="3" [value]="inputs()[i.name]" (input)="setInput(i.name, $any($event.target).value)"></textarea> }
                    @case ('number') { <input type="number" [min]="i.min" [max]="i.max" [value]="inputs()[i.name]" (input)="setInput(i.name, +$any($event.target).value)" /> }
                    @default { <input type="text" maxlength="400" [value]="inputs()[i.name]" (input)="setInput(i.name, $any($event.target).value)" (keydown.enter)="run()" /> }
                  }
                </label>
              }
            </div>
          }
          <div class="actions">
            @for (a of actions(); track a.label; let first = $first) {
              <button type="button" class="btn" [class.btn-primary]="(a.tone ?? (first ? 'primary' : '')) === 'primary'" [class.btn-ghost]="a.tone === 'ghost'"
                      [disabled]="busy()" (click)="run(a)">
                @if (busy() && active() === a.label) { <span class="spinner" aria-hidden="true"></span> }
                {{ a.label }}
              </button>
            }
            <span class="mode-note">
              @if (api.live()) { <span class="pill pill-live">Claude · {{ api.config()?.model }}</span> }
              @else { <span class="pill">offline scripted model</span> }
              @if (result(); as r) { <span class="muted">last run {{ r.elapsedMs }} ms on {{ r.model }}</span> }
            </span>
          </div>
          @if (error()) { <div class="error" role="alert">⚠ {{ error() }}</div> }
          @if (result()?.error) { <div class="error" role="alert">⚠ {{ result()!.error }}</div> }
        </section>

        <section class="card visual">
          <h3>Result</h3>
          @if (result() || busy()) {
            <app-output-view [result]="result()" [liveEvents]="liveEvents()" [busy]="busy()" [streamKind]="d.stream ? (d.library === 'langgraph' ? 'lanes' : 'stream') : null"
                             (rerun)="run(undefined, $event)" />
          } @else {
            <p class="muted">Press <b>{{ actions()[0].label }}</b> to run the real {{ d.library === 'langchain' ? 'LangChain' : 'LangGraph' }} code below{{ d.stream ? ' and watch it stream live' : '' }}.</p>
          }
        </section>

        @if (result()?.checks?.length) {
          <section class="card">
            <h3>Self-checks <span class="muted">verified by the backend after the run</span></h3>
            <ul class="checks">
              @for (c of result()!.checks; track $index) {
                <li [class.ok]="c.ok" [class.bad]="!c.ok"><span>{{ c.ok ? '✓' : '✗' }}</span> {{ c.label }}
                  @if (c.detail !== null) { <code class="muted">{{ c.detail | json }}</code> }</li>
              }
            </ul>
          </section>
        }

        <section class="card">
          <div class="tabs" role="tablist">
            @for (t of tabs; track t.id) {
              <button type="button" role="tab" [class.tab-active]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
            }
          </div>
          @switch (tab()) {
            @case ('code') {
              <p class="muted tab-note">This is the exact function the backend executed (read with inspect.getsource). <code>ctx.model()</code> returns
                <code>ChatAnthropic</code> when an API key is configured, otherwise an offline <code>ScriptedChatModel</code>; <code>ctx.config</code> attaches the tracer that powers the animation.</p>
              <app-code-block [code]="summary()?.source ?? ''" lang="python" [name]="'backend/app/demos/' + (d.library === 'langchain' ? 'langchain_demos.py' : 'langgraph_demos.py')" />
            }
            @case ('trace') { <app-trace-view [trace]="result()?.trace ?? []" /> }
            @case ('mermaid') {
              <p class="muted tab-note">graph.get_graph().draw_mermaid(): paste into any Mermaid renderer.</p>
              <app-code-block [code]="graph()?.mermaid ?? ''" lang="text" name="graph.mmd" />
            }
            @case ('raw') { <app-code-block [code]="(result() | json) ?? 'Run the demo first.'" lang="json" name="response.json" /> }
          }
        </section>

        <nav class="pager">
          @if (prev(); as p) { <a [routerLink]="['/demo', p.id]" class="btn btn-ghost">← {{ p.title }}</a> } @else { <span></span> }
          @if (next(); as n) { <a [routerLink]="['/demo', n.id]" class="btn btn-ghost">{{ n.title }} →</a> }
        </nav>
      </article>
    } @else {
      <p class="muted">Unknown demo. <a routerLink="/">Back to the overview</a>.</p>
    }
  `,
})
export class DemoPage {
  readonly api = inject(ApiService);
  readonly id = input.required<string>();

  readonly info = computed(() => INFO_BY_ID[this.id()]);
  readonly summary = computed(() => this.api.summary(this.id()));
  readonly inputs = signal<Record<string, unknown>>({});
  readonly result = signal<DemoResult | null>(null);
  readonly busy = signal(false);
  readonly active = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly liveEvents = signal<TimelineEvent[]>([]);
  readonly runKey = signal(0);
  readonly tab = signal<Tab>('code');
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'code', label: 'Code that ran' }, { id: 'trace', label: 'Execution timeline' },
    { id: 'mermaid', label: 'Mermaid' }, { id: 'raw', label: 'Raw response' },
  ];

  readonly actions = computed<DemoAction[]>(() => this.info()?.actions ?? [{ label: 'Run demo' }]);
  readonly graph = computed(() => this.result()?.graph ?? this.summary()?.graph ?? null);
  readonly steps = computed(() => buildSteps(this.graph(), this.result()?.trace ?? [], this.result()?.events ?? []));

  private readonly ordered = computed(() => this.api.demos().map((d) => INFO_BY_ID[d.id]).filter(Boolean));
  readonly prev = computed(() => { const l = this.ordered(); const i = l.findIndex((d) => d.id === this.id()); return i > 0 ? l[i - 1] : null; });
  readonly next = computed(() => { const l = this.ordered(); const i = l.findIndex((d) => d.id === this.id()); return i >= 0 && i < l.length - 1 ? l[i + 1] : null; });

  constructor() {
    // Load the saved state whenever the route switches to another demo.
    effect(() => {
      const id = this.id();
      const info = INFO_BY_ID[id];
      untracked(() => {
        const saved = SAVED.get(id);
        this.inputs.set(saved?.inputs ?? (info ? defaultInputs(info) : {}));
        this.result.set(saved?.result ?? null);
        this.error.set(null);
        this.liveEvents.set([]);
        this.tab.set('code');
      });
    });
  }

  setInput(name: string, value: unknown): void {
    this.inputs.update((i) => ({ ...i, [name]: value }));
    this.save();
  }

  async run(action?: DemoAction, extra: Record<string, unknown> = {}): Promise<void> {
    const info = this.info();
    if (!info || this.busy()) return;
    const id = info.id;
    const chosen = action ?? (Object.keys(extra).length ? undefined : this.actions()[0]);
    const payload = { ...this.inputs(), ...(chosen?.inputs ?? {}), ...extra };
    this.busy.set(true);
    this.active.set(chosen?.label ?? null);
    this.error.set(null);
    this.liveEvents.set([]);
    try {
      const result = info.stream
        ? await this.api.stream(id, payload, (e) => this.liveEvents.update((l) => [...l, e]))
        : await this.api.run(id, payload);
      if (this.id() !== id) {
        SAVED.set(id, { inputs: payload, result });
        return;
      }
      this.result.set(result);
      this.runKey.update((k) => k + 1);
      this.api.suiteStatus.update((s) => ({ ...s, [id]: !result.error && result.checks.every((c) => c.ok) ? 'pass' : 'fail' }));
      this.save();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
      this.active.set(null);
    }
  }

  private save(): void {
    SAVED.set(this.id(), { inputs: this.inputs(), result: this.result() });
  }
}
