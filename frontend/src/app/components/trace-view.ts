import { JsonPipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { TraceRun } from '../models';

/** Waterfall of every traced run (from LangChain callbacks): overlapping bars = concurrency. */
@Component({
  selector: 'app-trace-view',
  imports: [JsonPipe],
  template: `
    @if (runs().length) {
      <div class="waterfall">
        @for (r of runs(); track r.id) {
          <button type="button" class="wf-row" [class.wf-open]="open() === r.id" (click)="open.set(open() === r.id ? null : r.id)">
            <span class="wf-name"><span class="kind-dot" [class]="'kind-' + r.kind"></span>{{ r.node && r.node !== r.name ? r.node + ' › ' : '' }}{{ r.name }}</span>
            <span class="wf-track">
              <span class="wf-bar" [class]="'kind-bg-' + r.kind" [class.wf-error]="!!r.error"
                    [style.left.%]="100 * r.startMs / total()" [style.width.%]="Math.max(0.8, 100 * (r.durationMs ?? 0) / total())"
                    [style.animation-delay.ms]="$index * 40"></span>
            </span>
            <code class="wf-ms">{{ r.durationMs ?? '…' }} ms</code>
          </button>
          @if (open() === r.id) {
            <div class="wf-detail">
              <div><b>input</b><pre>{{ r.input | json }}</pre></div>
              <div><b>{{ r.error ? 'error' : 'output' }}</b><pre>{{ r.error ?? (r.output | json) }}</pre></div>
            </div>
          }
        }
      </div>
      <div class="legend">
        @for (k of kinds; track k) { <span><span class="kind-dot" [class]="'kind-' + k"></span>{{ k }}</span> }
      </div>
    } @else {
      <p class="muted">No callback runs recorded for this demo (it is plain Python around LangChain objects).</p>
    }
  `,
})
export class TraceView {
  readonly trace = input<TraceRun[]>([]);
  readonly open = signal<string | null>(null);
  readonly kinds = ['chain', 'prompt', 'llm', 'parser', 'tool', 'retriever'];
  readonly Math = Math;
  readonly runs = computed(() => [...this.trace()].sort((a, b) => a.startMs - b.startMs));
  readonly total = computed(() => Math.max(1, ...this.runs().map((r) => r.endMs ?? r.startMs)));
}
