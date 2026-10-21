import { Component, computed, input, signal } from '@angular/core';

const PY_KEYWORDS = new Set(('def class return if elif else for while in not and or is None True False import from as with try except finally ' +
  'raise lambda yield async await pass break continue global nonlocal assert del').split(' '));

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A tiny tokenizer-based highlighter: enough for Python, JSON, shell and Dockerfiles. */
export function highlight(code: string, lang: string): string {
  const pattern = lang === 'python'
    ? /("""[\s\S]*?"""|'''[\s\S]*?'''|f?"(?:\\.|[^"\\\n])*"|f?'(?:\\.|[^'\\\n])*')|(#[^\n]*)|(@[\w.]+)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)\b(?=\s*\()|\b([A-Za-z_]\w*)\b/g
    : /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(#[^\n]*)|(@[\w.]+)|\b(\d+(?:\.\d+)?)\b|()()/g;
  let html = '';
  let last = 0;
  for (const m of code.matchAll(pattern)) {
    const [text, str, comment, deco, num, call, word] = m;
    if (!text) continue;
    html += escapeHtml(code.slice(last, m.index));
    last = m.index! + text.length;
    const esc = escapeHtml(text);
    if (str) html += `<span class="tk-str">${esc}</span>`;
    else if (comment) html += `<span class="tk-com">${esc}</span>`;
    else if (deco) html += `<span class="tk-deco">${esc}</span>`;
    else if (num) html += `<span class="tk-num">${esc}</span>`;
    else if (call) html += PY_KEYWORDS.has(call) ? `<span class="tk-kw">${esc}</span>` : `<span class="tk-fn">${esc}</span>`;
    else if (word && PY_KEYWORDS.has(word)) html += `<span class="tk-kw">${esc}</span>`;
    else if (word && /^[A-Z]/.test(word)) html += `<span class="tk-cls">${esc}</span>`;
    else html += esc;
  }
  return html + escapeHtml(code.slice(last));
}

@Component({
  selector: 'app-code-block',
  template: `
    <div class="code-block">
      @if (name()) {
        <div class="code-head">
          <span class="code-name">{{ name() }}</span>
          <button type="button" class="btn btn-ghost btn-small" (click)="copy()">{{ copied() ? 'Copied ✓' : 'Copy' }}</button>
        </div>
      }
      <pre><code [innerHTML]="html()"></code></pre>
    </div>
  `,
})
export class CodeBlock {
  readonly code = input('');
  readonly lang = input<string>('python');
  readonly name = input<string | null>(null);
  readonly copied = signal(false);
  readonly html = computed(() => highlight(this.code(), this.lang()));

  copy(): void {
    navigator.clipboard?.writeText(this.code()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }
}
