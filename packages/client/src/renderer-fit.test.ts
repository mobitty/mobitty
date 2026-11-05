import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cellSize, swapAndRefit, type CellSize } from './renderer-fit.ts';

const dims = (width: number, height: number) => ({ css: { cell: { width, height } } });

describe('cellSize', () => {
  it('reads the CSS cell', () => {
    assert.deepEqual(cellSize(dims(5.86, 13)), { width: 5.86, height: 13 });
  });
  it('is null while unmeasured', () => {
    assert.equal(cellSize(undefined), null);
    assert.equal(cellSize(dims(0, 13)), null);
    assert.equal(cellSize(dims(5.86, 0)), null);
  });
});

describe('swapAndRefit', () => {
  function run(before: CellSize | null, after: CellSize | null) {
    let cell = before;
    let fits = 0;
    const refit = swapAndRefit(() => cell, () => { cell = after; }, () => { fits++; });
    return { refit, fits };
  }

  it('refits when DOM → WebGL narrows the cell (dpr 3: 64 → 66 columns at 378 px)', () => {
    const dom = { width: 5.86, height: 13 };
    const webgl = { width: Math.floor(5.86 * 3) / 3, height: 13 };
    assert.equal(Math.floor(378 / dom.width), 64);
    assert.equal(Math.floor(378 / webgl.width), 66);
    assert.deepEqual(run(dom, webgl), { refit: true, fits: 1 });
  });
  it('refits when WebGL is lost and the DOM renderer takes over', () => {
    assert.deepEqual(run({ width: 17 / 3, height: 13 }, { width: 5.86, height: 13 }), { refit: true, fits: 1 });
  });
  it('refits when only the height changes', () => {
    assert.deepEqual(run({ width: 6, height: 13 }, { width: 6, height: 14 }), { refit: true, fits: 1 });
  });
  it('does not refit when the cell is unchanged (no-op swap)', () => {
    assert.deepEqual(run({ width: 6, height: 13 }, { width: 6, height: 13 }), { refit: false, fits: 0 });
  });
  it('refits when the cell is first measured by the swap', () => {
    assert.deepEqual(run(null, { width: 6, height: 13 }), { refit: true, fits: 1 });
  });
  it('does not refit while the terminal is unmeasured', () => {
    assert.deepEqual(run({ width: 6, height: 13 }, null), { refit: false, fits: 0 });
  });
});
