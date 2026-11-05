/**
 * Renderer swaps change the terminal's cell size, so they must refit.
 *
 * xterm's DOM renderer uses the font's exact advance width for a cell; the
 * WebGL renderer floors it to whole device pixels (`floor(width * dpr) / dpr`).
 * At dpr 3 a 10 px Cascadia cell is 5.86 px in the DOM and 5.67 px in WebGL:
 * a 378 px terminal fits 64 columns in one and 66 in the other. xterm doesn't
 * refit on its own when the renderer changes, so a swap without a fit leaves
 * the grid sized for the old renderer until some unrelated resize (a keyboard
 * coming and going) refits it.
 */

export interface CellSize {
  width: number;
  height: number;
}

interface DimensionsLike {
  css: { cell: { width: number; height: number } };
}

/** The CSS cell size from `terminal.dimensions`, or null while unmeasured. */
export function cellSize(dims: DimensionsLike | undefined): CellSize | null {
  if (!dims) return null;
  const { width, height } = dims.css.cell;
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

/**
 * Run `swap` (a renderer load or dispose) and call `fit` when it changed the
 * cell size. Returns whether it refit.
 */
export function swapAndRefit(measure: () => CellSize | null, swap: () => void, fit: () => void): boolean {
  const before = measure();
  swap();
  const after = measure();
  if (!after) return false;
  if (before && before.width === after.width && before.height === after.height) return false;
  fit();
  return true;
}
