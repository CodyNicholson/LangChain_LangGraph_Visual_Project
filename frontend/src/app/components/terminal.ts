import { Component, OnDestroy, effect, input, signal, untracked } from '@angular/core';

/** Types commands out character by character, like someone at a shell. */
@Component({
  selector: 'app-terminal',
  template: `
    <div class="terminal" role="img" [attr.aria-label]="'Terminal: ' + commands().join('; ')">
      <div class="terminal-bar"><span></span><span></span><span></span></div>
      <pre>@for (line of done(); track $index) {<span class="t-line"><span class="t-prompt">{{ line.startsWith('#') ? '' : '$ ' }}</span><span [class.t-comment]="line.startsWith('#')">{{ line }}</span></span>
}<span class="t-line"><span class="t-prompt">$ </span>{{ typing() }}<span class="t-cursor"></span></span></pre>
    </div>
  `,
})
export class Terminal implements OnDestroy {
  readonly commands = input<string[]>([]);
  readonly done = signal<string[]>([]);
  readonly typing = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const cmds = this.commands();
      untracked(() => this.start(cmds));
    });
  }

  private start(cmds: string[]): void {
    if (this.timer) clearTimeout(this.timer);
    this.done.set([]);
    this.typing.set('');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.done.set([...cmds]);
      return;
    }
    let line = 0;
    let ch = 0;
    const tick = () => {
      if (line >= cmds.length) return;
      const cmd = cmds[line];
      if (ch <= cmd.length) {
        this.typing.set(cmd.slice(0, ch++));
        this.timer = setTimeout(tick, cmd.startsWith('#') ? 8 : 28);
      } else {
        this.done.update((d) => [...d, cmd]);
        this.typing.set('');
        line++;
        ch = 0;
        this.timer = setTimeout(tick, 380);
      }
    };
    this.timer = setTimeout(tick, 250);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
