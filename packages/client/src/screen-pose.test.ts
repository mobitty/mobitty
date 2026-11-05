import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDuoDockVars, applyDuoRootState, dockAttr, dockRect, DUO_DOCK_VARS, duoDockVars, duoRootState,
  isTabletop, MIN_DOCK_HEIGHT, panelDock, parseScreenPose, tabletopPaneB,
  type DuoDock, type DuoPanel, type DuoRootTarget,
} from './screen-pose.ts';
import type { DuoShape, ScreenPosePayload } from './native-bridge.ts';

// From the plan's ScreenPose unit-test table (window points = CSS px).
const COLUMN: ScreenPosePayload = {
  shape: 'column', folded: false, band: null,
  paneA: { x: 0, y: 0, w: 382, h: 644 }, paneB: null,
};
const COLUMN_TURNED: ScreenPosePayload = {
  shape: 'columnTurned', folded: false, band: null,
  paneA: { x: 84, y: 0, w: 594, h: 432 }, paneB: null,
};
const WIDE_FLAT: ScreenPosePayload = {
  shape: 'wide', folded: false, band: { x: 455.5, y: 0, w: 40, h: 669 },
  paneA: { x: 0, y: 0, w: 463.5, h: 635 }, paneB: { x: 487.5, y: 0, w: 379.5, h: 635 },
};
const BOOK: ScreenPosePayload = {
  shape: 'wide', folded: true, band: { x: 455.5, y: 0, w: 40, h: 669 },
  paneA: { x: 0, y: 0, w: 447.5, h: 635 }, paneB: { x: 503.5, y: 0, w: 363.5, h: 635 },
};
const TALL_FLAT: ScreenPosePayload = {
  shape: 'tall', folded: false, band: { x: 0, y: 455.5, w: 669, h: 40 },
  paneA: { x: 0, y: 82, w: 669, h: 381.5 }, paneB: { x: 0, y: 487.5, w: 669, h: 429.5 },
};
const TABLETOP: ScreenPosePayload = {
  shape: 'tall', folded: true, band: { x: 0, y: 455.5, w: 669, h: 40 },
  paneA: { x: 0, y: 82, w: 669, h: 365.5 }, paneB: { x: 0, y: 503.5, w: 669, h: 413.5 },
};

const ALL: Record<string, ScreenPosePayload> = {
  column: COLUMN, columnTurned: COLUMN_TURNED, wideFlat: WIDE_FLAT, book: BOOK,
  tallFlat: TALL_FLAT, tabletop: TABLETOP,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe('parseScreenPose', () => {
  for (const [name, pose] of Object.entries(ALL)) {
    it(`parses ${name} from its JSON`, () => {
      assert.deepEqual(parseScreenPose(JSON.parse(JSON.stringify(pose))), pose);
    });
  }

  it('parses the plan\'s closed payload literally', () => {
    const json = '{"shape":"column","folded":false,"band":null,"paneA":{"x":0,"y":0,"w":382,"h":644},"paneB":null}';
    assert.deepEqual(parseScreenPose(JSON.parse(json)), COLUMN);
  });

  it('drops extra fields', () => {
    const value = { ...clone(BOOK), extra: 1, paneA: { ...BOOK.paneA, z: 3 } };
    assert.deepEqual(parseScreenPose(value), BOOK);
  });

  it('rejects null, undefined and non-objects', () => {
    for (const v of [null, undefined, 'wide', 42, [], true]) {
      assert.equal(parseScreenPose(v), null);
    }
  });

  it('rejects an unknown shape', () => {
    for (const shape of ['system', 'book', 'WIDE', '', 1]) {
      assert.equal(parseScreenPose({ ...clone(WIDE_FLAT), shape }), null);
    }
  });

  it('rejects missing fields', () => {
    for (const key of ['shape', 'folded', 'band', 'paneA', 'paneB']) {
      const value: Record<string, unknown> = clone(BOOK);
      delete value[key];
      assert.equal(parseScreenPose(value), null, key);
    }
    for (const key of ['x', 'y', 'w', 'h']) {
      const value = clone(BOOK);
      const paneB: Record<string, unknown> = { ...value.paneB };
      delete paneB[key];
      assert.equal(parseScreenPose({ ...value, paneB }), null, key);
    }
  });

  it('rejects a null paneA', () => {
    assert.equal(parseScreenPose({ ...clone(COLUMN), paneA: null }), null);
  });

  it('rejects NaN, infinite, string and negative-size numbers', () => {
    for (const bad of [NaN, Infinity, '1', -1]) {
      const value = clone(WIDE_FLAT);
      assert.equal(parseScreenPose({ ...value, band: { ...value.band, w: bad } }), null, String(bad));
    }
    const value = clone(WIDE_FLAT);
    assert.equal(parseScreenPose({ ...value, paneA: { ...value.paneA, x: NaN } }), null);
  });

  it('rejects a non-boolean folded', () => {
    assert.equal(parseScreenPose({ ...clone(BOOK), folded: 'true' }), null);
  });
});

describe('duoRootState', () => {
  it('is empty off the Duo', () => {
    assert.deepEqual(duoRootState(null), { attrs: {}, vars: {} });
  });

  it('closed: shape, not folded, pane A only', () => {
    assert.deepEqual(duoRootState(COLUMN), {
      attrs: { 'data-duo-shape': 'column', 'data-duo-folded': 'false' },
      vars: {
        '--duo-pane-a-x': '0px', '--duo-pane-a-y': '0px', '--duo-pane-a-w': '382px', '--duo-pane-a-h': '644px',
      },
    });
    assert.equal(duoRootState(COLUMN_TURNED).attrs['data-duo-shape'], 'columnTurned');
    assert.equal(duoRootState(COLUMN_TURNED).vars['--duo-pane-a-x'], '84px');
  });

  it('book: band and both panes', () => {
    assert.deepEqual(duoRootState(BOOK), {
      attrs: { 'data-duo-shape': 'wide', 'data-duo-folded': 'true' },
      vars: {
        '--duo-band-x': '455.5px', '--duo-band-y': '0px', '--duo-band-w': '40px', '--duo-band-h': '669px',
        '--duo-pane-a-x': '0px', '--duo-pane-a-y': '0px', '--duo-pane-a-w': '447.5px', '--duo-pane-a-h': '635px',
        '--duo-pane-b-x': '503.5px', '--duo-pane-b-y': '0px', '--duo-pane-b-w': '363.5px', '--duo-pane-b-h': '635px',
      },
    });
  });

  it('per open shape', () => {
    const cases: [ScreenPosePayload, DuoShape, string][] = [
      [WIDE_FLAT, 'wide', 'false'], [BOOK, 'wide', 'true'],
      [TALL_FLAT, 'tall', 'false'], [TABLETOP, 'tall', 'true'],
    ];
    for (const [pose, shape, folded] of cases) {
      const { attrs, vars } = duoRootState(pose);
      assert.deepEqual(attrs, { 'data-duo-shape': shape, 'data-duo-folded': folded });
      assert.equal(Object.keys(vars).length, 12);
    }
    assert.equal(duoRootState(TABLETOP).vars['--duo-pane-b-y'], '503.5px');
  });
});

class FakeRoot implements DuoRootTarget {
  attrs = new Map<string, string>();
  props = new Map<string, string>();
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  style = {
    setProperty: (name: string, value: string): void => { this.props.set(name, value); },
    removeProperty: (name: string): string => { const v = this.props.get(name) ?? ''; this.props.delete(name); return v; },
  };
}

describe('applyDuoRootState', () => {
  it('writes the state and clears what the next state drops', () => {
    const root = new FakeRoot();
    root.setAttribute('id', 'root');
    root.style.setProperty('--other', '1');
    applyDuoRootState(root, duoRootState(BOOK));
    assert.equal(root.attrs.get('data-duo-shape'), 'wide');
    assert.equal(root.props.get('--duo-pane-b-w'), '363.5px');

    applyDuoRootState(root, duoRootState(COLUMN));
    assert.equal(root.attrs.get('data-duo-shape'), 'column');
    assert.equal(root.props.has('--duo-pane-b-w'), false);
    assert.equal(root.props.has('--duo-band-x'), false);
    assert.equal(root.props.get('--duo-pane-a-w'), '382px');

    applyDuoRootState(root, duoRootState(null));
    assert.deepEqual([...root.attrs.keys()], ['id']);
    assert.deepEqual([...root.props.keys()], ['--other']);
  });
});

describe('panelDock', () => {
  const PANELS: DuoPanel[] = ['sessions', 'settings', 'shell', 'editor', 'input', 'viewer'];
  const expected: Record<string, Record<DuoPanel, DuoDock>> = {
    null: { sessions: 'full', settings: 'full', shell: 'full', editor: 'full', input: 'full', viewer: 'full' },
    column: { sessions: 'full', settings: 'full', shell: 'full', editor: 'full', input: 'full', viewer: 'full' },
    columnTurned: { sessions: 'full', settings: 'full', shell: 'full', editor: 'full', input: 'full', viewer: 'full' },
    wideFlat: { sessions: 'paneB', settings: 'paneB', shell: 'paneB', editor: 'paneB', input: 'paneB', viewer: 'paneB' },
    book: { sessions: 'paneB', settings: 'paneB', shell: 'paneB', editor: 'paneB', input: 'paneB', viewer: 'paneB' },
    tallFlat: { sessions: 'paneB', settings: 'paneB', shell: 'paneB', editor: 'paneA', input: 'paneA', viewer: 'paneB' },
    tabletop: { sessions: 'paneB', settings: 'paneB', shell: 'paneB', editor: 'paneA', input: 'paneA', viewer: 'paneB' },
  };
  for (const [name, row] of Object.entries(expected)) {
    it(name, () => {
      const pose = name === 'null' ? null : ALL[name] ?? null;
      for (const panel of PANELS) assert.equal(panelDock(pose, panel), row[panel], `${name} ${panel}`);
    });
  }

  it('an open pose without pane B docks full', () => {
    assert.equal(panelDock({ ...WIDE_FLAT, paneB: null }, 'sessions'), 'full');
  });
});

describe('dockRect', () => {
  it('full is the whole frame', () => {
    const frame = { left: 10, top: 20, width: 300, height: 400 };
    assert.deepEqual(dockRect(BOOK, 'full', frame), { left: 0, top: 0, width: 300, height: 400 });
    assert.deepEqual(dockRect(null, 'paneB', frame), { left: 0, top: 0, width: 300, height: 400 });
    assert.deepEqual(dockRect(COLUMN, 'paneB', frame), { left: 0, top: 0, width: 300, height: 400 });
  });

  it('wide flat: x/width from the pane, top/height from the frame', () => {
    const frame = { left: 0, top: 0, width: 867, height: 405 };
    assert.deepEqual(dockRect(WIDE_FLAT, 'paneB', frame), { left: 487.5, top: 0, width: 379.5, height: 405 });
    assert.deepEqual(dockRect(WIDE_FLAT, 'paneA', frame), { left: 0, top: 0, width: 463.5, height: 405 });
  });

  it('book: frame offset is subtracted', () => {
    const frame = { left: 4, top: 30, width: 863, height: 375 };
    assert.deepEqual(dockRect(BOOK, 'paneB', frame), { left: 499.5, top: 0, width: 363.5, height: 375 });
  });

  it('tall flat with a 601-tall frame: pane B ends at the frame bottom', () => {
    const frame = { left: 0, top: 0, width: 669, height: 601 };
    assert.deepEqual(dockRect(TALL_FLAT, 'paneB', frame), { left: 0, top: 487.5, width: 669, height: 113.5 });
    assert.deepEqual(dockRect(TALL_FLAT, 'paneA', frame), { left: 0, top: 82, width: 669, height: 381.5 });
  });

  it('tall: frame below the status strip, pane bottom inside the frame', () => {
    const frame = { left: 0, top: 82, width: 669, height: 835 };
    assert.deepEqual(dockRect(TALL_FLAT, 'paneA', frame), { left: 0, top: 0, width: 669, height: 381.5 });
    assert.deepEqual(dockRect(TALL_FLAT, 'paneB', frame), { left: 0, top: 405.5, width: 669, height: 429.5 });
  });

  it('tall: a frame ending above the pane gives zero height', () => {
    const frame = { left: 0, top: 0, width: 669, height: 450 };
    assert.equal(dockRect(TALL_FLAT, 'paneB', frame).height, 0);
  });
});

describe('dockAttr', () => {
  it('maps panes to a/b and full to no attribute', () => {
    assert.equal(dockAttr('paneA'), 'a');
    assert.equal(dockAttr('paneB'), 'b');
    assert.equal(dockAttr('full'), undefined);
  });

  it('per pose, as the panels see it', () => {
    assert.equal(dockAttr(panelDock(WIDE_FLAT, 'sessions')), 'b');
    assert.equal(dockAttr(panelDock(WIDE_FLAT, 'editor')), 'b');
    assert.equal(dockAttr(panelDock(TALL_FLAT, 'input')), 'a');
    assert.equal(dockAttr(panelDock(TALL_FLAT, 'viewer')), 'b');
    assert.equal(dockAttr(panelDock(COLUMN, 'settings')), undefined);
    assert.equal(dockAttr(panelDock(null, 'shell')), undefined);
  });
});

describe('duoDockVars', () => {
  it('empty off the Duo and closed', () => {
    const frame = { left: 0, top: 0, width: 382, height: 644 };
    assert.deepEqual(duoDockVars(null, frame), {});
    assert.deepEqual(duoDockVars(COLUMN, frame), {});
    assert.deepEqual(duoDockVars(COLUMN_TURNED, frame), {});
  });

  it('wide flat, keyboard up (frame ends at 405): both panes, full frame height', () => {
    const vars = duoDockVars(WIDE_FLAT, { left: 0, top: 0, width: 867, height: 405 });
    assert.deepEqual(vars, {
      '--duo-dock-a-left': '0px', '--duo-dock-a-top': '0px', '--duo-dock-a-width': '463.5px', '--duo-dock-a-height': '405px',
      '--duo-dock-b-left': '487.5px', '--duo-dock-b-top': '0px', '--duo-dock-b-width': '379.5px', '--duo-dock-b-height': '405px',
    });
  });

  it('book: pane B narrows past the wider gutter', () => {
    const vars = duoDockVars(BOOK, { left: 0, top: 0, width: 867, height: 635 });
    assert.equal(vars['--duo-dock-b-left'], '503.5px');
    assert.equal(vars['--duo-dock-b-width'], '363.5px');
    assert.equal(vars['--duo-dock-a-width'], '447.5px');
  });

  it('tall flat below the status strip', () => {
    const vars = duoDockVars(TALL_FLAT, { left: 0, top: 82, width: 669, height: 835 });
    assert.equal(vars['--duo-dock-a-top'], '0px');
    assert.equal(vars['--duo-dock-a-height'], '381.5px');
    assert.equal(vars['--duo-dock-b-top'], '405.5px');
    assert.equal(vars['--duo-dock-b-height'], '429.5px');
  });

  it('tall: a pane cut below MIN_DOCK_HEIGHT falls back to the whole frame', () => {
    // 601-tall frame from 0: pane B keeps 113.5 (usable).
    assert.equal(duoDockVars(TALL_FLAT, { left: 0, top: 0, width: 669, height: 601 })['--duo-dock-b-height'], '113.5px');
    const frame = { left: 0, top: 82, width: 669, height: 450 }; // ends at 532: B would be 44.5
    assert.ok(532 - 487.5 < MIN_DOCK_HEIGHT);
    const vars = duoDockVars(TALL_FLAT, frame);
    assert.equal(vars['--duo-dock-b-top'], '0px');
    assert.equal(vars['--duo-dock-b-height'], '450px');
    assert.equal(vars['--duo-dock-a-height'], '381.5px');
  });

  it('a pose without pane B writes only pane A', () => {
    const pose = { ...WIDE_FLAT, paneB: null };
    const vars = duoDockVars(pose, { left: 0, top: 0, width: 867, height: 635 });
    assert.equal(Object.keys(vars).length, 4);
    assert.equal(vars['--duo-dock-b-left'], undefined);
  });
});

describe('applyDuoDockVars', () => {
  it('writes the vars and clears them when the Duo closes', () => {
    const frame = new FakeRoot();
    frame.style.setProperty('--other', '1');
    applyDuoDockVars(frame, duoDockVars(WIDE_FLAT, { left: 0, top: 0, width: 867, height: 635 }));
    assert.equal(frame.props.size, 9);
    applyDuoDockVars(frame, duoDockVars(COLUMN, { left: 0, top: 0, width: 382, height: 644 }));
    assert.deepEqual([...frame.props.keys()], ['--other']);
    assert.equal(DUO_DOCK_VARS.length, 8);
  });
});

describe('isTabletop', () => {
  it('is tall and folded only', () => {
    for (const [name, pose] of Object.entries(ALL)) {
      assert.equal(isTabletop(pose), name === 'tabletop', name);
    }
    assert.equal(isTabletop(null), false);
    assert.equal(isTabletop({ ...TABLETOP, paneB: null }), false);
  });
});

describe('tabletopPaneB', () => {
  it('rests the session list while no keyboard is up', () => {
    assert.equal(tabletopPaneB(TABLETOP, 'system', 951), 'sessions');
    assert.equal(tabletopPaneB(TABLETOP, 'dismissed', 951), 'sessions');
    assert.equal(tabletopPaneB(TABLETOP, null, 951), 'sessions');
    // The visual viewport ends exactly at pane B's top: still no keyboard over it.
    assert.equal(tabletopPaneB(TABLETOP, 'system', 503.5), 'sessions');
  });

  it('is blank under the terminal keyboard (it fills pane B; the viewport keeps its height)', () => {
    assert.equal(tabletopPaneB(TABLETOP, 'terminal', 951), 'blank');
  });

  it('is blank under the system keyboard (the viewport ends at the band top)', () => {
    assert.equal(tabletopPaneB(TABLETOP, 'system', 455.5), 'blank');
    assert.equal(tabletopPaneB(TABLETOP, 'dismissed', 455.5), 'blank');
  });

  it('is blank off tabletop', () => {
    for (const [name, pose] of Object.entries(ALL)) {
      if (name === 'tabletop') continue;
      assert.equal(tabletopPaneB(pose, 'system', 951), 'blank', name);
    }
    assert.equal(tabletopPaneB(null, 'dismissed', 951), 'blank');
  });
});
