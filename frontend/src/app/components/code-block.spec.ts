import { highlight } from './code-block';

describe('highlight', () => {
  it('escapes HTML and marks Python tokens', () => {
    const html = highlight('@tool\ndef f(x):  # <b>\n    return "a<b"', 'python');
    expect(html).toContain('<span class="tk-deco">@tool</span>');
    expect(html).toContain('<span class="tk-kw">def</span>');
    expect(html).toContain('<span class="tk-com"># &lt;b&gt;</span>');
    expect(html).toContain('<span class="tk-str">"a&lt;b"</span>');
    expect(html).not.toContain('<b>');
  });

  it('leaves unknown languages escaped but readable', () => {
    expect(highlight('a < b', 'text')).toBe('a &lt; b');
  });
});
