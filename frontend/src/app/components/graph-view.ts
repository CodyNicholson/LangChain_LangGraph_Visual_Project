import { AfterViewInit, Component, Directive, ElementRef, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { GraphData, Library } from '../models';
import { AnimStep, layoutGraph } from './graph-layout';

/** SMIL animations added after page load must be started by hand, or they jump to their end state. */
@Directive({ selector: '[appBeginMotion]' })
export class BeginMotion implements AfterViewInit {
  private readonly el = inject(ElementRef);
  ngAfterViewInit(): void {
    (this.el.nativeElement as SVGAnimationElement).beginElement?.();
  }
}

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

@Component({
  selector: 'app-graph-view',
  imports: [BeginMotion],
  template: `
    @if (layout(); as l) {
      <div class="graph" [class.lib-langgraph]="library() === 'langgraph'">
        <svg [attr.viewBox]="'0 0 ' + l.width + ' ' + l.height" [style.max-width.px]="l.width * 1.25" role="img"
             [attr.aria-label]="'Graph with ' + l.nodes.length + ' nodes'">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head" />
            </marker>
            <marker id="arrow-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head-hot" />
            </marker>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          @for (e of l.edges; track $index) {
            <path [attr.d]="e.path" class="g-edge" [class.g-edge-cond]="e.conditional" [class.g-edge-back]="e.back"
                  [class.g-edge-hot]="hotEdge() === e.source + '>' + e.target"
                  [attr.marker-end]="hotEdge() === e.source + '>' + e.target ? 'url(#arrow-hot)' : 'url(#arrow)'" />
            @if (e.label && e.label !== e.target) {
              <text [attr.x]="e.labelX" [attr.y]="e.labelY" class="g-edge-label" text-anchor="middle">{{ e.label }}</text>
            }
          }

          @for (n of l.nodes; track n.id) {
            <g [attr.transform]="'translate(' + (n.x - n.w / 2) + ',' + (n.y - n.h / 2) + ')'"
               class="g-node" [class]="'role-' + n.role" [class.g-terminal]="n.terminal"
               [class.g-active]="current()?.nodeId === n.id" [class.g-visited]="(visits()[n.id] ?? 0) > 0">
              @if (current()?.nodeId === n.id && !reduced) {
                <rect class="g-pulse" x="-5" y="-5" [attr.width]="n.w + 10" [attr.height]="n.h + 10" [attr.rx]="n.terminal ? 18 : 13" />
              }
              <rect class="g-box" [attr.width]="n.w" [attr.height]="n.h" [attr.rx]="n.terminal ? 13 : 9"
                    [attr.filter]="current()?.nodeId === n.id ? 'url(#glow)' : null" />
              @if (!n.terminal) { <circle cx="13" [attr.cy]="n.h / 2" r="4" class="g-dot" /> }
              <text [attr.x]="n.terminal ? n.w / 2 : 24" [attr.y]="n.h / 2 + 4" class="g-label"
                    [attr.text-anchor]="n.terminal ? 'middle' : 'start'">{{ n.display }}</text>
              @if ((visits()[n.id] ?? 0) > 1) {
                <g [attr.transform]="'translate(' + (n.w - 6) + ',-6)'">
                  <circle r="9" class="g-badge" /><text y="3.5" text-anchor="middle" class="g-badge-text">×{{ visits()[n.id] }}</text>
                </g>
              }
            </g>
          }

          @if (packetPath(); as p) {
            @if (!reduced) {
              <g class="g-packet">
                <circle r="9" class="g-packet-halo" /><circle r="5" class="g-packet-core" />
                @for (k of [packetKey()]; track k) {
                  <animateMotion appBeginMotion dur="0.55s" begin="indefinite" fill="freeze" [attr.path]="p" />
                }
              </g>
            }
          }
        </svg>

        <div class="g-caption" aria-live="polite">
          @if (current(); as c) {
            <b>{{ label(c.nodeId) }}</b>
            @if (c.captions.length) { <span class="muted"> · </span><code>{{ c.captions.join('  ·  ') }}</code> }
          } @else if (index() >= steps().length && steps().length) {
            <span class="muted">Done: {{ steps().length }} steps. Replay or click a step.</span>
          } @else {
            <span class="muted">Run the demo to animate the real execution path.</span>
          }
        </div>

        @if (showSteps() && steps().length) {
          <ol class="g-steps">
            @for (s of steps(); track $index) {
              <li [class.now]="$index === index()" [class.done]="$index < index()">
                <button type="button" (click)="jump($index)">
                  <span class="g-step-n">{{ $index + 1 }}</span>
                  <span class="g-step-node">{{ label(s.nodeId) }}</span>
                  @if (s.captions.length) { <code>{{ s.captions[0] }}</code> }
                </button>
              </li>
            }
          </ol>
        }
      </div>
    }
  `,
})
export class GraphView implements OnDestroy {
  readonly graph = input<GraphData | null>(null);
  readonly steps = input<AnimStep[]>([]);
  readonly runKey = input(0);
  readonly library = input<Library>('langchain');
  readonly showSteps = input(true);

  readonly reduced = prefersReducedMotion();
  readonly index = signal(-1);
  readonly packetKey = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly layout = computed(() => {
    const g = this.graph();
    return g && g.nodes.length ? layoutGraph(g) : null;
  });

  readonly current = computed(() => {
    const i = this.index();
    const s = this.steps();
    return i >= 0 && i < s.length ? s[i] : null;
  });

  readonly visits = computed(() => {
    const counts: Record<string, number> = {};
    const upto = Math.min(this.index(), this.steps().length - 1);
    for (let i = 0; i <= upto; i++) {
      const id = this.steps()[i].nodeId;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  });

  /** The edge the packet travels along to reach the current step (if the graph has one). */
  readonly hotEdge = computed(() => {
    const i = this.index();
    const s = this.steps();
    if (i <= 0 || i >= s.length) return null;
    const key = `${s[i - 1].nodeId}>${s[i].nodeId}`;
    return this.layout()?.edges.some((e) => `${e.source}>${e.target}` === key) ? key : null;
  });

  readonly packetPath = computed(() => {
    const key = this.hotEdge();
    return key ? (this.layout()?.edges.find((e) => `${e.source}>${e.target}` === key)?.path ?? null) : null;
  });

  constructor() {
    effect(() => {
      this.runKey();
      const steps = this.steps();
      untracked(() => this.play(steps.length));
    });
  }

  label(id: string): string {
    return this.layout()?.byId.get(id)?.display ?? id;
  }

  jump(i: number): void {
    this.stop();
    this.index.set(i);
    this.packetKey.update((k) => k + 1);
  }

  private play(count: number): void {
    this.stop();
    if (!count) {
      this.index.set(-1);
      return;
    }
    if (this.reduced) {
      this.index.set(count);
      return;
    }
    const delay = Math.max(380, Math.min(950, 9000 / count));
    this.index.set(0);
    this.timer = setInterval(() => {
      const next = this.index() + 1;
      this.index.set(next);
      this.packetKey.update((k) => k + 1);
      if (next >= count) this.stop();
    }, delay);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
