import { Component, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from './api.service';
import { DEMO_INFO, LANGCHAIN_CATEGORIES, LANGGRAPH_CATEGORIES } from './data/catalog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="app">
      <header class="topbar">
        <a class="brand" routerLink="/">
          <span class="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32"><circle cx="7" cy="9" r="3.4" /><circle cx="25" cy="9" r="3.4" /><circle cx="16" cy="24" r="3.4" />
              <path d="M7 9 L16 24 L25 9" /><path d="M7 9 L25 9" class="logo-loop" /></svg>
          </span>
          <div>
            <h1>LangChain &amp; LangGraph Visual Lab</h1>
            <p>FastAPI · LangChain · LangGraph · Angular: every button runs real Python</p>
          </div>
        </a>
        <div class="top-actions">
          <button type="button" class="menu-btn" (click)="menuOpen.set(!menuOpen())" [attr.aria-expanded]="menuOpen()">☰ Menu</button>
          <label class="toggle" [class.toggle-disabled]="!api.config()?.liveAvailable"
                 [title]="api.config()?.liveAvailable ? 'Use Claude for model calls' : 'Add ANTHROPIC_API_KEY to .env to enable'">
            <input type="checkbox" [checked]="api.live()" [disabled]="!api.config()?.liveAvailable" (change)="api.setLive($any($event.target).checked)" />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
            <span>{{ api.live() ? 'Live: Claude' : 'Offline model' }}</span>
          </label>
        </div>
      </header>

      @if (api.loadError()) {
        <div class="error mt" role="alert">⚠ Could not reach the backend: {{ api.loadError() }}. Is the backend container running?</div>
      }

      <div class="layout">
        <nav class="sidebar" [class.sidebar-open]="menuOpen()" aria-label="Sections">
          <a routerLink="/" routerLinkActive="nav-active" [routerLinkActiveOptions]="{ exact: true }" class="nav-item">Overview</a>
          <div class="nav-group">
            <div class="nav-heading">Get started</div>
            <a routerLink="/start/langchain" routerLinkActive="nav-active" class="nav-item">Create a LangChain project</a>
            <a routerLink="/start/langgraph" routerLinkActive="nav-active" class="nav-item">Create a LangGraph project</a>
            <a routerLink="/compare" routerLinkActive="nav-active" class="nav-item">Pros &amp; cons</a>
          </div>
          @for (lib of libs; track lib.id) {
            <div class="nav-lib" [class.nav-lib-lg]="lib.id === 'langgraph'">{{ lib.name }}</div>
            @for (cat of lib.categories; track cat) {
              <div class="nav-group">
                <div class="nav-heading">{{ cat }}</div>
                @for (d of demosIn(lib.id, cat); track d.id) {
                  <a [routerLink]="['/demo', d.id]" routerLinkActive="nav-active" class="nav-item">
                    <span>{{ d.title }}</span>
                    @switch (api.suiteStatus()[d.id]) {
                      @case ('pass') { <span class="ok" aria-label="passed">✓</span> }
                      @case ('fail') { <span class="bad" aria-label="failed">✗</span> }
                      @case ('running') { <span class="spinner spinner-sm"></span> }
                    }
                  </a>
                }
              </div>
            }
          }
          <div class="nav-group">
            <a routerLink="/suite" routerLinkActive="nav-active" class="nav-item nav-suite">▶ Run all demos (self-test)</a>
          </div>
        </nav>

        <main class="main"><router-outlet /></main>
      </div>
    </div>
  `,
})
export class App implements OnInit {
  readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly menuOpen = signal(false);
  readonly libs = [
    { id: 'langchain', name: 'LangChain', categories: LANGCHAIN_CATEGORIES },
    { id: 'langgraph', name: 'LangGraph', categories: LANGGRAPH_CATEGORIES },
  ];

  ngOnInit(): void {
    this.api.load();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.menuOpen.set(false));
  }

  demosIn(library: string, category: string) {
    return DEMO_INFO.filter((d) => d.library === library && d.category === category);
  }
}
