import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../api.service';
import { INFO_BY_ID, defaultInputs } from '../data/catalog';
import { DemoResult } from '../models';

/** Runs every demo once against the backend (offline model) and reports its self-checks. */
@Component({
  selector: 'app-suite-page',
  imports: [RouterLink],
  template: `
    <article class="demo">
      <header class="demo-head">
        <span class="chip">Self-test</span>
        <h2>Run every demo</h2>
        <p class="tagline">Calls each demo on the backend with its default inputs and the offline scripted model (free and deterministic), then shows the checks the backend verified.</p>
      </header>
      <section class="card">
        <div class="actions">
          <button type="button" class="btn btn-primary" [disabled]="running()" (click)="runAll()">
            @if (running()) { <span class="spinner"></span> } {{ running() ? 'Running…' : '▶ Run all ' + api.demos().length + ' demos' }}
          </button>
          @if (done()) {
            <span class="pill" [class.pill-ok]="failed() === 0" [class.pill-bad]="failed() > 0">{{ passed() }}/{{ api.demos().length }} demos · {{ checks() }} checks passed · {{ totalMs() }} ms</span>
          }
        </div>
        <div class="progress mt"><span [style.width.%]="100 * Object.keys(results()).length / (api.demos().length || 1)"></span></div>
        <table class="table mt">
          <thead><tr><th>Demo</th><th>Library</th><th>Status</th><th>Checks</th><th>Time</th></tr></thead>
          <tbody>
            @for (d of api.demos(); track d.id) {
              @let r = results()[d.id];
              <tr>
                <td><a [routerLink]="['/demo', d.id]">{{ d.title }}</a></td>
                <td><span class="chip" [class.chip-lg]="d.library === 'langgraph'">{{ d.library }}</span></td>
                <td>
                  @switch (api.suiteStatus()[d.id]) {
                    @case ('running') { <span class="spinner"></span> }
                    @case ('pass') { <span class="ok">✓ pass</span> }
                    @case ('fail') { <span class="bad">✗ fail</span> }
                    @default { <span class="muted">—</span> }
                  }
                </td>
                <td>
                  @if (r) {
                    {{ okCount(r) }}/{{ r.checks.length }}
                    @for (c of r.checks; track $index) { @if (!c.ok) { <div class="bad small">✗ {{ c.label }}</div> } }
                    @if (r.error) { <div class="bad small">{{ r.error }}</div> }
                  }
                </td>
                <td>{{ r ? r.elapsedMs + ' ms' : '' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    </article>
  `,
})
export class SuitePage {
  readonly api = inject(ApiService);
  readonly Object = Object;
  readonly running = signal(false);
  readonly results = signal<Record<string, DemoResult>>({});
  readonly done = computed(() => !this.running() && Object.keys(this.results()).length > 0);
  readonly passed = computed(() => Object.values(this.results()).filter((r) => this.ok(r)).length);
  readonly failed = computed(() => Object.keys(this.results()).length - this.passed());
  readonly checks = computed(() => Object.values(this.results()).reduce((a, r) => a + this.okCount(r), 0));
  readonly totalMs = computed(() => Math.round(Object.values(this.results()).reduce((a, r) => a + r.elapsedMs, 0)));

  okCount(r: DemoResult): number {
    return r.checks.filter((c) => c.ok).length;
  }

  private ok(r: DemoResult): boolean {
    return !r.error && r.checks.length > 0 && r.checks.every((c) => c.ok);
  }

  async runAll(): Promise<void> {
    this.running.set(true);
    this.results.set({});
    for (const d of this.api.demos()) {
      this.api.suiteStatus.update((s) => ({ ...s, [d.id]: 'running' }));
      const info = INFO_BY_ID[d.id];
      const inputs = { ...(info ? defaultInputs(info) : {}), ...(d.stateful ? { session: 'suite', thread: 'suite', user_id: 'suite' } : {}) };
      try {
        const r = await this.api.run(d.id, inputs, false);
        this.results.update((all) => ({ ...all, [d.id]: r }));
        this.api.suiteStatus.update((s) => ({ ...s, [d.id]: this.ok(r) ? 'pass' : 'fail' }));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.results.update((all) => ({ ...all, [d.id]: { id: d.id, error, checks: [], elapsedMs: 0 } as unknown as DemoResult }));
        this.api.suiteStatus.update((s) => ({ ...s, [d.id]: 'fail' }));
      }
    }
    this.running.set(false);
  }
}
