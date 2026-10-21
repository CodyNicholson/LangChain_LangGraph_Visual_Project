import { JsonPipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { DemoResult, TimelineEvent } from '../models';
import { CodeBlock } from './code-block';

const CHUNK_COLORS = ['#2dd4bf', '#a78bfa', '#f472b6', '#fbbf24', '#60a5fa', '#34d399', '#fb923c', '#e879f9'];

/** Renders a demo's output according to output.kind: chat, state timeline, chunks, lanes, … */
@Component({
  selector: 'app-output-view',
  imports: [JsonPipe, DecimalPipe, CodeBlock],
  template: `
    @let out = result()?.output;
    @switch (kind()) {
      @case ('messages') {
        <div class="chat">
          @for (m of out.messages; track $index) {
            <div class="bubble" [class]="'bubble-' + m.type" [style.animation-delay.ms]="$index * 90">
              <div class="bubble-role">{{ roleName(m) }}</div>
              @if (m.content) { <div class="bubble-text">{{ text(m.content) }}</div> }
              @for (c of m.tool_calls ?? []; track $index) {
                <div class="tool-call"><span class="chip chip-tool">tool_call</span> <code>{{ c.name }}({{ c.args | json }})</code></div>
              }
            </div>
          } @empty {
            <p class="muted">No messages in this session yet.</p>
          }
        </div>
        @if (out.usage) { <p class="muted mt">usage_metadata: <code>{{ out.usage | json }}</code></p> }
        @if (out.middleware_log?.length) {
          <h4>Middleware log</h4>
          <ol class="log">@for (l of out.middleware_log; track $index) { <li><code>{{ l }}</code></li> }</ol>
        }
        @if (out.trimmed_to !== undefined) { <p class="muted mt">trim_messages(max 6, strategy="last") would keep {{ out.trimmed_to }} of {{ out.messages.length }} messages.</p> }
        @if (out.variables) { <p class="muted mt">input_variables: <code>{{ out.variables | json }}</code> · partial_variables: <code>{{ out.partials | json }}</code></p> }
      }

      @case ('text') {
        <div class="answer">{{ out.text }}</div>
        <p class="muted mt">chain.steps: @for (s of out.steps; track $index) { <span class="chip chip-soft">{{ s }}</span> }</p>
      }

      @case ('stream') {
        <div class="answer stream-text">
          @for (c of streamChunks(); track $index) { <span class="tok">{{ c }}</span> }
          @if (busy()) { <span class="t-cursor"></span> }
        </div>
        <p class="muted mt">{{ streamChunks().length }} chunks received{{ busy() ? ' so far…' : '' }}</p>
      }

      @case ('lanes') {
        <div class="lanes">
          @for (mode of laneModes(); track mode) {
            <div class="lane">
              <div class="lane-name"><code>{{ mode }}</code><span class="muted">{{ laneEvents(mode).length }}</span></div>
              <div class="lane-track">
                @for (e of laneEvents(mode); track $index) {
                  <span class="lane-chip" [class]="'lane-' + mode" [title]="(e.data | json)">{{ laneText(mode, e) }}</span>
                }
              </div>
            </div>
          }
        </div>
      }

      @case ('chunks') {
        <div class="ruler" aria-label="Where each chunk sits in the document">
          @for (c of out.chunks; track $index) {
            <span class="ruler-seg" [style.left.%]="100 * c.start / out.source.length" [style.width.%]="100 * c.text.length / out.source.length"
                  [style.top.px]="($index % 3) * 9" [style.background]="color($index)" [title]="'chunk ' + ($index + 1)"></span>
          }
        </div>
        <div class="chunks">
          @for (c of out.chunks; track $index) {
            <div class="chunk" [style.border-color]="color($index)" [style.animation-delay.ms]="$index * 60">
              <div class="chunk-head"><b [style.color]="color($index)">#{{ $index + 1 }}</b> <span class="muted">{{ c.text.length }} chars · start {{ c.start }}</span>
                @if (c.metadata.section) { <span class="chip chip-soft">{{ c.metadata.section }}</span> }</div>
              <div class="chunk-text">{{ c.text }}</div>
            </div>
          }
        </div>
      }

      @case ('rag') {
        <div class="answer">{{ out.answer }}</div>
        <h4>Retrieved chunks (similarity_search_with_score) <span class="muted">of {{ out.chunk_count }} indexed</span></h4>
        @for (h of out.hits; track $index) {
          <div class="hit" [style.animation-delay.ms]="$index * 120">
            <div class="hit-bar"><span [style.width.%]="100 * h.score / maxScore()"></span></div>
            <div class="hit-body"><code>{{ h.score | number: '1.3-3' }}</code> <span>{{ h.text }}</span></div>
          </div>
        }
      }

      @case ('timings') {
        @if (out.text) { <div class="answer">{{ out.text }}</div> }
        <div class="bars">
          @for (b of out.bars; track $index) {
            <div class="bar-row">
              <span class="bar-label">{{ b.label }}</span>
              <span class="bar-track"><span class="bar-fill" [style.width.%]="100 * b.ms / maxBar()" [style.animation-delay.ms]="$index * 200"></span></span>
              <code class="bar-value">{{ b.ms }} ms</code>
            </div>
          }
        </div>
        @if (out.calls) { <p class="muted mt">Node executions: <code>{{ out.calls | json }}</code></p> }
        @if (out.results) { <ol class="log mt">@for (r of out.results; track $index) { <li>{{ r }}</li> }</ol> }
      }

      @case ('events') {
        <ol class="events">
          @for (e of out.events; track $index) {
            <li [style.animation-delay.ms]="$index * 70"><code class="ev-ms">{{ e.ms }} ms</code> <span class="chip chip-soft">{{ e.event }}</span> <code>{{ e.name }}</code></li>
          }
        </ol>
        <p class="muted mt">LangSmith tracing: <b>{{ out.langsmith ? 'on' : 'off' }}</b> (set LANGSMITH_TRACING=true and LANGSMITH_API_KEY in .env)</p>
      }

      @case ('checkpoints') {
        <div class="split">
          <div class="chat">
            @for (m of out.messages; track $index) {
              <div class="bubble" [class]="'bubble-' + m.type"><div class="bubble-role">{{ roleName(m) }}</div><div class="bubble-text">{{ text(m.content) }}</div></div>
            }
          </div>
          <div>
            <h4>get_state_history() · thread <code>{{ out.thread }}</code></h4>
            <ol class="cp-list">
              @for (c of out.checkpoints; track c.id) {
                <li [style.animation-delay.ms]="$index * 60"><span class="cp-dot"></span>
                  <code>step {{ c.step }}</code> <span class="chip chip-soft">{{ c.source }}</span>
                  <span class="muted">next: {{ c.next.length ? c.next.join(', ') : '—' }} · {{ c.messages }} msgs</span></li>
              }
            </ol>
          </div>
        </div>
      }

      @case ('hitl') {
        @if (out.status === 'interrupted') {
          <div class="approval">
            <div class="approval-head"><span class="pulse-dot"></span> Graph paused at <code>human_review</code> · thread <code>{{ out.thread_id }}</code></div>
            <p><b>{{ out.interrupt.question }}</b></p>
            <p class="muted">{{ out.interrupt.request }}</p>
            <div class="inputs">
              <label class="input"><span>Amount (for "edit")</span><input type="number" [value]="amount() ?? out.interrupt.amount" (input)="amount.set(+$any($event.target).value)" /></label>
            </div>
            <div class="actions">
              <button class="btn btn-primary" [disabled]="busy()" (click)="resume('approve')">Approve \${{ out.interrupt.amount }}</button>
              <button class="btn" [disabled]="busy()" (click)="resume('edit')">Edit &amp; approve</button>
              <button class="btn btn-danger" [disabled]="busy()" (click)="resume('reject')">Reject</button>
            </div>
            <p class="muted mt">Each button sends <code>Command(resume={{ '{' }}"action": …{{ '}' }})</code> to the same thread.</p>
          </div>
        } @else {
          <div class="answer">✓ {{ out.state.result }}</div>
          <p class="muted mt">Final state: <code>{{ out.state | json }}</code></p>
        }
      }

      @case ('timetravel') {
        <div class="split">
          <div class="branch">
            <h4>Original run</h4>
            <div class="answer small">{{ out.original.joke }}</div>
            <p class="muted">topic: <code>{{ out.original.topic }}</code> · rating {{ out.original.rating }}</p>
          </div>
          <div class="branch branch-fork">
            <h4>Forked from checkpoint <code>…{{ out.fork_from.slice(-6) }}</code></h4>
            <div class="answer small">{{ out.forked.joke }}</div>
            <p class="muted">topic: <code>{{ out.forked.topic }}</code> · rating {{ out.forked.rating }}</p>
          </div>
        </div>
        <h4>Checkpoint tree</h4>
        <div class="tree">
          @for (lane of branches(); track $index) {
            <div class="tree-lane" [class.tree-fork]="$index === 0">
              <span class="muted tree-name">{{ $index === 0 ? 'fork' : 'original' }}</span>
              @for (c of lane; track c.id) {
                <span class="tree-node" [class.tree-shared]="shared().has(c.id)" [class.tree-forkpoint]="c.id === out.fork_from"
                      [title]="c.values | json" [style.animation-delay.ms]="$index * 80">
                  {{ c.next.length ? c.next[0] : 'done' }}<small>{{ c.source }}</small>
                </span>
              }
            </div>
          }
        </div>
      }

      @case ('store') {
        <div class="answer">{{ out.reply }}</div>
        <h4>Store namespace <code>("memories", "{{ out.user }}")</code> <span class="muted">· this request ran in thread {{ out.thread }}</span></h4>
        @for (m of out.memories; track m.key) {
          <div class="memory"><code>{{ m.score ?? '—' }}</code> {{ m.text }}</div>
        } @empty { <p class="muted">No memories yet. Send a "Remember …" message.</p> }
      }

      @case ('state') {
        <div class="state-timeline">
          @for (e of result()!.events; track $index) {
            <div class="state-step" [style.animation-delay.ms]="$index * 110">
              <span class="state-node">{{ e.label }}</span>
              <code class="state-update">{{ e.data | json }}</code>
            </div>
          }
        </div>
        <h4>Final state</h4>
        <app-code-block [code]="(out.final | json)" lang="json" />
        @if (out.timing) { <p class="muted mt">Wall time {{ out.timing.wallMs }} ms vs {{ out.timing.sumOfModelCallsMs }} ms of model calls added up: parallel.</p> }
      }

      @case ('json') {
        <app-code-block [code]="(out.data | json)" lang="json" />
        @if (out.timing) { <p class="muted mt">Wall time {{ out.timing.wallMs }} ms vs {{ out.timing.sumOfModelCallsMs }} ms of model calls added up: parallel.</p> }
      }

      @default {
        @if (out) { <app-code-block [code]="(out | json)" lang="json" /> }
      }
    }
  `,
})
export class OutputView {
  readonly result = input<DemoResult | null>(null);
  readonly liveEvents = input<TimelineEvent[]>([]);
  readonly busy = input(false);
  readonly streamKind = input<string | null>(null);
  readonly rerun = output<Record<string, unknown>>();
  readonly amount = signal<number | null>(null);

  readonly kind = computed(() => (this.busy() && this.streamKind()) || this.result()?.output?.kind || null);
  private readonly events = computed(() => (this.busy() ? this.liveEvents() : this.result()?.events ?? []));

  readonly streamChunks = computed(() =>
    this.busy() ? this.liveEvents().filter((e) => e.label === 'chunk').map((e) => String(e.data)) : (this.result()?.output?.chunks ?? []));

  readonly laneModes = computed<string[]>(() => this.result()?.output?.modes ?? ['values', 'updates', 'custom', 'messages']);
  laneEvents(mode: string): TimelineEvent[] {
    return this.events().filter((e) => e.label === mode);
  }
  laneText(mode: string, e: TimelineEvent): string {
    if (mode === 'messages') return e.data?.token ?? '';
    if (mode === 'custom') return e.data?.found ?? JSON.stringify(e.data);
    if (mode === 'updates') return Object.keys(e.data ?? {}).join(', ');
    return `{${Object.keys(e.data ?? {}).join(', ')}}`;
  }

  readonly maxScore = computed(() => Math.max(0.0001, ...(this.result()?.output?.hits ?? []).map((h: any) => h.score)));
  readonly maxBar = computed(() => Math.max(1, ...(this.result()?.output?.bars ?? []).map((b: any) => b.ms)));

  /** Checkpoint lineages for the time-travel tree: one lane per leaf, oldest first. */
  readonly branches = computed(() => {
    const cps: any[] = this.result()?.output?.checkpoints ?? [];
    const byId = new Map(cps.map((c) => [c.id, c]));
    const parents = new Set(cps.map((c) => c.parent).filter(Boolean));
    const leaves = cps.filter((c) => !parents.has(c.id));
    return leaves.map((leaf) => {
      const lane = [];
      for (let c = leaf; c; c = byId.get(c.parent)) lane.unshift(c);
      return lane;
    });
  });
  readonly shared = computed(() => {
    const [a, b] = this.branches();
    if (!a || !b) return new Set<string>();
    const ids = new Set(b.map((c: any) => c.id));
    return new Set(a.filter((c: any) => ids.has(c.id)).map((c: any) => c.id));
  });

  color(i: number): string {
    return CHUNK_COLORS[i % CHUNK_COLORS.length];
  }

  roleName(m: any): string {
    return m.type === 'human' ? 'Human' : m.type === 'ai' ? 'AI' : m.type === 'tool' ? `Tool · ${m.name ?? ''}` : m.type === 'system' ? 'System' : m.type;
  }

  text(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
    return JSON.stringify(content);
  }

  resume(decision: string): void {
    const out = this.result()?.output;
    this.rerun.emit({ action: 'resume', thread_id: out.thread_id, decision, amount: decision === 'edit' ? this.amount() ?? out.interrupt.amount : null });
    this.amount.set(null);
  }
}
