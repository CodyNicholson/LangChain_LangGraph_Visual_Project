import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AppConfig, DemoResult, DemoSummary, TimelineEvent } from './models';

const LIVE_KEY = 'langlab.live';

function readLive(): boolean {
  try {
    return localStorage.getItem(LIVE_KEY) === '1';
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  readonly config = signal<AppConfig | null>(null);
  readonly demos = signal<DemoSummary[]>([]);
  readonly loadError = signal<string | null>(null);
  /** Use Claude instead of the offline scripted model (only when the backend has a key). */
  readonly live = signal(readLive());
  /** Self-test status per demo id, shown as ✓/✗ in the sidebar. */
  readonly suiteStatus = signal<Record<string, 'pass' | 'fail' | 'running'>>({});

  async load(): Promise<void> {
    try {
      const [config, demos] = await Promise.all([
        firstValueFrom(this.http.get<AppConfig>('/api/config')),
        firstValueFrom(this.http.get<DemoSummary[]>('/api/demos')),
      ]);
      this.config.set(config);
      this.demos.set(demos);
      if (!config.liveAvailable) this.live.set(false);
    } catch (error) {
      this.loadError.set(this.message(error));
    }
  }

  setLive(value: boolean): void {
    this.live.set(value);
    try {
      localStorage.setItem(LIVE_KEY, value ? '1' : '0');
    } catch {
      /* private mode: the toggle just won't persist */
    }
  }

  summary(id: string): DemoSummary | undefined {
    return this.demos().find((d) => d.id === id);
  }

  async run(id: string, inputs: Record<string, unknown>, live = this.live()): Promise<DemoResult> {
    try {
      return await firstValueFrom(this.http.post<DemoResult>(`/api/demos/${id}/run`, { inputs, live }));
    } catch (error) {
      throw new Error(this.message(error));
    }
  }

  /** Server-Sent Events: onEvent fires for every streamed event, the promise resolves with the result. */
  stream(id: string, inputs: Record<string, unknown>, onEvent: (event: TimelineEvent) => void): Promise<DemoResult> {
    const params = new URLSearchParams({ inputs: JSON.stringify(inputs), live: String(this.live()) });
    return new Promise((resolve, reject) => {
      const source = new EventSource(`/api/demos/${id}/stream?${params}`);
      source.addEventListener('event', (e) => onEvent(JSON.parse((e as MessageEvent).data)));
      source.addEventListener('result', (e) => {
        source.close();
        resolve(JSON.parse((e as MessageEvent).data).result);
      });
      source.onerror = () => {
        source.close();
        // EventSource hides the HTTP status; ask again with fetch to surface 400/429 messages.
        fetch(`/api/demos/${id}/stream?${params}`)
          .then(async (r) => reject(new Error(r.ok ? 'Stream interrupted' : (await r.json()).detail ?? r.statusText)))
          .catch(() => reject(new Error('Stream interrupted')));
      };
    });
  }

  private message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail;
      return typeof detail === 'string' ? detail : `${error.status} ${error.statusText || 'request failed'}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
