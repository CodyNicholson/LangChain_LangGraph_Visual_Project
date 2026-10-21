import { Component, computed, effect, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CodeBlock } from '../components/code-block';
import { Terminal } from '../components/terminal';
import { LANGCHAIN_GUIDE, LANGGRAPH_GUIDE } from '../data/guides';

@Component({
  selector: 'app-guide-page',
  imports: [CodeBlock, Terminal, RouterLink],
  template: `
    @let g = guide();
    <article class="demo" [class.lib-langgraph]="g.library === 'langgraph'">
      <header class="demo-head">
        <span class="chip" [class.chip-lg]="g.library === 'langgraph'">Getting started</span>
        <h2>{{ g.title }}</h2>
        <p class="tagline">{{ g.intro }}</p>
      </header>

      <div class="guide">
        <nav class="stepper" aria-label="Steps">
          @for (s of g.steps; track $index) {
            <button type="button" class="step-btn" [class.step-active]="$index === active()" [class.step-done]="$index < active()" (click)="active.set($index)">
              <span class="step-num">{{ $index < active() ? '✓' : $index + 1 }}</span>
              <span>{{ s.title }}</span>
            </button>
          }
          <div class="card tree-card">
            <h4>Project layout</h4>
            <pre class="tree-pre">{{ g.tree }}</pre>
          </div>
        </nav>

        <section class="card step-body">
          @let s = g.steps[active()];
          <div class="step-kicker">Step {{ active() + 1 }} of {{ g.steps.length }}</div>
          <h3>{{ s.title }}</h3>
          <p>{{ s.text }}</p>
          @if (s.commands?.length) { <app-terminal [commands]="s.commands!" /> }
          @if (s.file) { <app-code-block [code]="s.file.code" [lang]="s.file.lang" [name]="s.file.name" /> }
          <div class="actions mt">
            <button type="button" class="btn btn-ghost" [disabled]="active() === 0" (click)="active.set(active() - 1)">← Back</button>
            @if (active() < g.steps.length - 1) {
              <button type="button" class="btn btn-primary" (click)="active.set(active() + 1)">Next step →</button>
            } @else {
              <a class="btn btn-primary" [routerLink]="['/demo', g.library === 'langchain' ? 'lc-models' : 'lg-basics']">Explore the {{ g.library === 'langchain' ? 'LangChain' : 'LangGraph' }} demos →</a>
            }
          </div>
        </section>
      </div>
    </article>
  `,
})
export class GuidePage {
  readonly library = input<'langchain' | 'langgraph'>('langchain');
  readonly guide = computed(() => (this.library() === 'langgraph' ? LANGGRAPH_GUIDE : LANGCHAIN_GUIDE));
  readonly active = signal(0);

  constructor() {
    effect(() => {
      this.library();
      untracked(() => this.active.set(0));
    });
  }
}
