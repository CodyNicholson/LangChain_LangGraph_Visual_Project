import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { DEMO_INFO } from './data/catalog';

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('renders the brand and a nav link for every demo', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('LangChain & LangGraph Visual Lab');
    const links = Array.from(el.querySelectorAll('.sidebar a')).map((a) => a.getAttribute('href'));
    for (const d of DEMO_INFO) expect(links).toContain(`/demo/${d.id}`);
  });

  it('loads config and demos from the API and shows backend errors', async () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/config').flush('down', { status: 502, statusText: 'Bad Gateway' });
    http.expectOne('/api/demos').flush([]);
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.error')?.textContent).toContain('Could not reach the backend');
  });
});
