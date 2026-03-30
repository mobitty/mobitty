import type { ITerminalAddon, Terminal } from '@xterm/xterm';

export class OverlayAddon implements ITerminalAddon {
  private terminal: Terminal | null = null;
  private overlayNode: HTMLElement;
  private overlayTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.overlayNode = document.createElement('div');
    this.overlayNode.style.cssText = `border-radius: 15px;
font-size: xx-large;
opacity: 0.75;
padding: 0.2em 0.5em 0.2em 0.5em;
position: absolute;
-webkit-user-select: none;
-webkit-transition: opacity 180ms ease-in;
-moz-user-select: none;
-moz-transition: opacity 180ms ease-in;`;

    this.overlayNode.addEventListener(
      'mousedown',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
  }

  activate(terminal: Terminal): void {
    this.terminal = terminal;
  }

  dispose(): void {}

  hideOverlay(): void {
    if (this.overlayTimeout) {
      clearTimeout(this.overlayTimeout);
      this.overlayTimeout = undefined;
    }
    if (this.overlayNode.parentNode) {
      this.overlayNode.parentNode.removeChild(this.overlayNode);
    }
  }

  showOverlay(msg: string, timeout?: number): void {
    const terminal = this.terminal;
    if (!terminal?.element) return;

    this.overlayNode.style.color = '#101010';
    this.overlayNode.style.backgroundColor = '#f0f0f0';
    this.overlayNode.textContent = msg;
    this.overlayNode.style.opacity = '0.75';

    if (!this.overlayNode.parentNode) {
      terminal.element.appendChild(this.overlayNode);
    }

    const divSize = terminal.element.getBoundingClientRect();
    const overlaySize = this.overlayNode.getBoundingClientRect();

    this.overlayNode.style.top = (divSize.height - overlaySize.height) / 2 + 'px';
    this.overlayNode.style.left = (divSize.width - overlaySize.width) / 2 + 'px';

    if (this.overlayTimeout) clearTimeout(this.overlayTimeout);
    if (!timeout) return;

    this.overlayTimeout = setTimeout(() => {
      this.overlayNode.style.opacity = '0';
      this.overlayTimeout = setTimeout(() => {
        if (this.overlayNode.parentNode) {
          this.overlayNode.parentNode.removeChild(this.overlayNode);
        }
        this.overlayTimeout = undefined;
        this.overlayNode.style.opacity = '0.75';
      }, 200);
    }, timeout);
  }
}
