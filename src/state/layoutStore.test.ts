import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store reads localStorage at module-load time, so we use
// vi.resetModules + dynamic import to get a fresh instance per test
// — that's the only way to exercise the legacy-migration paths in
// `loadInitial*`. For the action tests we still re-import once and
// reset state between cases.
const SCRY_KEYS = [
  'scry.layout',
  'scry.panels',
  'scry.dockLocation',
  'scry.panelOrder',
  'scry.railWidths',
  'scry.leftSplit',
  'scry.panelsLocked',
];

function clearAllScryStorage() {
  for (const k of [...Object.keys(localStorage)]) {
    if (k.startsWith('scry.')) localStorage.removeItem(k);
  }
}

beforeEach(() => {
  clearAllScryStorage();
  vi.resetModules();
});
afterEach(() => {
  clearAllScryStorage();
});

async function loadStore() {
  return await import('./layoutStore');
}

describe('layoutStore — defaults', () => {
  it('initializes with documented defaults when nothing is persisted', async () => {
    const { useLayoutStore, DEFAULT_VISIBILITY, DEFAULT_DOCK_LOCATION, DEFAULT_PANEL_ORDER, DEFAULT_LEFT_WIDTH, DEFAULT_RIGHT_WIDTH, DEFAULT_LEFT_SPLIT } = await loadStore();
    const s = useLayoutStore.getState();
    expect(s.visibility).toEqual(DEFAULT_VISIBILITY);
    expect(s.dockLocation).toEqual(DEFAULT_DOCK_LOCATION);
    expect(s.panelOrder).toEqual(DEFAULT_PANEL_ORDER);
    expect(s.panelsLocked).toBe(false);
    expect(s.railWidths).toEqual({ left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH });
    expect(s.leftSplit).toBe(DEFAULT_LEFT_SPLIT);
  });
});

describe('layoutStore — legacy migration on first load', () => {
  it('reads scry.panels into visibility', async () => {
    localStorage.setItem('scry.panels', JSON.stringify({ buffs: true, combat: true }));
    const { useLayoutStore } = await loadStore();
    expect(useLayoutStore.getState().visibility.buffs).toBe(true);
    expect(useLayoutStore.getState().visibility.combat).toBe(true);
  });

  it('reads scry.dockLocation into dockLocation', async () => {
    localStorage.setItem('scry.dockLocation', JSON.stringify({ stats: 'floating' }));
    const { useLayoutStore } = await loadStore();
    expect(useLayoutStore.getState().dockLocation.stats).toBe('floating');
  });

  it('reads scry.panelOrder into panelOrder and backfills missing keys', async () => {
    // Saved order omits buffs and combat — they should land in their
    // default-rail tail per loadInitialPanelOrder's backfill logic.
    localStorage.setItem('scry.panelOrder', JSON.stringify({
      left:  ['spawnPoints', 'spawns'],          // reversed
      right: ['chat', 'group', 'stats'],         // missing buffs + combat
    }));
    const { useLayoutStore } = await loadStore();
    const order = useLayoutStore.getState().panelOrder;
    expect(order.left).toEqual(['spawnPoints', 'spawns']);
    expect(order.right.slice(0, 3)).toEqual(['chat', 'group', 'stats']);
    // Backfilled (default rail = right for both)
    expect(order.right).toContain('buffs');
    expect(order.right).toContain('combat');
  });

  it('reads scry.railWidths and clamps out-of-range values', async () => {
    localStorage.setItem('scry.railWidths', JSON.stringify({ left: 10, right: 9999 }));
    const { useLayoutStore, RAIL_MIN, RAIL_MAX } = await loadStore();
    const rw = useLayoutStore.getState().railWidths;
    expect(rw.left).toBe(RAIL_MIN);
    expect(rw.right).toBe(RAIL_MAX);
  });

  it('reads scry.leftSplit and clamps it', async () => {
    localStorage.setItem('scry.leftSplit', '0.99');
    const { useLayoutStore, LEFT_SPLIT_MAX } = await loadStore();
    expect(useLayoutStore.getState().leftSplit).toBe(LEFT_SPLIT_MAX);
  });

  it('falls back to defaults when legacy keys are malformed', async () => {
    localStorage.setItem('scry.panels', '{not valid json');
    localStorage.setItem('scry.dockLocation', '{also bad');
    localStorage.setItem('scry.panelOrder', '???');
    localStorage.setItem('scry.leftSplit', 'NaN');
    const { useLayoutStore, DEFAULT_VISIBILITY, DEFAULT_DOCK_LOCATION, DEFAULT_PANEL_ORDER, DEFAULT_LEFT_SPLIT } = await loadStore();
    const s = useLayoutStore.getState();
    expect(s.visibility).toEqual(DEFAULT_VISIBILITY);
    expect(s.dockLocation).toEqual(DEFAULT_DOCK_LOCATION);
    expect(s.panelOrder).toEqual(DEFAULT_PANEL_ORDER);
    expect(s.leftSplit).toBe(DEFAULT_LEFT_SPLIT);
  });
});

describe('layoutStore — actions', () => {
  it('togglePanel flips visibility', async () => {
    const { useLayoutStore } = await loadStore();
    const before = useLayoutStore.getState().visibility.spawns;
    useLayoutStore.getState().togglePanel('spawns');
    expect(useLayoutStore.getState().visibility.spawns).toBe(!before);
  });

  it('hidePanel always sets visibility to false', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().hidePanel('spawns');
    useLayoutStore.getState().hidePanel('spawns'); // idempotent
    expect(useLayoutStore.getState().visibility.spawns).toBe(false);
  });

  it('setPanelsLocked persists into the store key', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().setPanelsLocked(true);
    expect(useLayoutStore.getState().panelsLocked).toBe(true);
    const persisted = JSON.parse(localStorage.getItem('scry.layout') ?? '{}');
    expect(persisted.state.panelsLocked).toBe(true);
  });

  it('setLeftRailWidth and setRightRailWidth clamp at MIN/MAX', async () => {
    const { useLayoutStore, RAIL_MIN, RAIL_MAX } = await loadStore();
    useLayoutStore.getState().setLeftRailWidth(-9999);
    expect(useLayoutStore.getState().railWidths.left).toBe(RAIL_MIN);
    useLayoutStore.getState().setLeftRailWidth(9999);
    expect(useLayoutStore.getState().railWidths.left).toBe(RAIL_MAX);
    // Right rail grows leftward — negative dx grows it.
    useLayoutStore.setState({ railWidths: { left: 320, right: 320 } });
    useLayoutStore.getState().setRightRailWidth(-9999);
    expect(useLayoutStore.getState().railWidths.right).toBe(RAIL_MAX);
  });

  it('setLeftSplit clamps at MIN/MAX', async () => {
    const { useLayoutStore, LEFT_SPLIT_MIN, LEFT_SPLIT_MAX } = await loadStore();
    useLayoutStore.getState().setLeftSplit(() => -1);
    expect(useLayoutStore.getState().leftSplit).toBe(LEFT_SPLIT_MIN);
    useLayoutStore.getState().setLeftSplit(() => 2);
    expect(useLayoutStore.getState().leftSplit).toBe(LEFT_SPLIT_MAX);
  });

  it('undock with anchor seeds windowPos/Size for the floating instance', async () => {
    const { useLayoutStore } = await loadStore();
    // Mock window dimensions so center-offset math is predictable.
    Object.defineProperty(window, 'innerWidth',  { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    useLayoutStore.getState().undock('spawns', { x: 100, y: 200, w: 300, h: 400 });
    expect(useLayoutStore.getState().dockLocation.spawns).toBe('floating');
    expect(JSON.parse(localStorage.getItem('scry.windowPos.panel.spawns')!))
      // Anchor center (250, 400) - viewport center (500, 400) = (-250, 0)
      .toEqual({ x: -250, y: 0 });
    expect(JSON.parse(localStorage.getItem('scry.windowSize.panel.spawns')!))
      .toEqual({ w: 300, h: 400 });
  });

  it('undock without anchor flips dockLocation only', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().undock('spawns');
    expect(useLayoutStore.getState().dockLocation.spawns).toBe('floating');
    expect(localStorage.getItem('scry.windowPos.panel.spawns')).toBeNull();
    expect(localStorage.getItem('scry.windowSize.panel.spawns')).toBeNull();
  });
});

describe('layoutStore — dockToSlot', () => {
  it('inserts at the end of the rail when slot is omitted', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().undock('stats');                     // remove from right rail
    useLayoutStore.getState().dockToSlot('stats', 'right');        // re-dock at end
    const r = useLayoutStore.getState().panelOrder.right;
    expect(r[r.length - 1]).toBe('stats');
  });

  it('inserts at slot 0 (top of rail)', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().undock('combat');
    useLayoutStore.getState().dockToSlot('combat', 'right', 0);
    expect(useLayoutStore.getState().panelOrder.right[0]).toBe('combat');
  });

  it('inserts at a middle slot', async () => {
    const { useLayoutStore } = await loadStore();
    // Default right order: stats, buffs, targetEffects, group, chat, combat, expLog, lootHistory
    useLayoutStore.getState().undock('chat');
    useLayoutStore.getState().dockToSlot('chat', 'right', 1);
    expect(useLayoutStore.getState().panelOrder.right).toEqual(
      ['stats', 'chat', 'buffs', 'targetEffects', 'group', 'combat', 'expLog', 'lootHistory'],
    );
  });

  it('clamps a negative slot to 0', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().undock('chat');
    useLayoutStore.getState().dockToSlot('chat', 'right', -50);
    expect(useLayoutStore.getState().panelOrder.right[0]).toBe('chat');
  });

  it('clamps an oversized slot to the array length', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().undock('chat');
    useLayoutStore.getState().dockToSlot('chat', 'right', 999);
    const r = useLayoutStore.getState().panelOrder.right;
    expect(r[r.length - 1]).toBe('chat');
  });

  it('cross-rail move splices key out of source rail and into target', async () => {
    const { useLayoutStore } = await loadStore();
    // Spawns starts on left; move it to the right rail at slot 0.
    useLayoutStore.getState().dockToSlot('spawns', 'right', 0);
    const order = useLayoutStore.getState().panelOrder;
    expect(order.left).not.toContain('spawns');
    expect(order.right[0]).toBe('spawns');
    expect(useLayoutStore.getState().dockLocation.spawns).toBe('right');
  });

  it('resetDockTo returns the panel to its DEFAULT_DOCK_LOCATION rail', async () => {
    const { useLayoutStore, DEFAULT_DOCK_LOCATION } = await loadStore();
    useLayoutStore.getState().dockToSlot('spawns', 'right', 0);
    useLayoutStore.getState().resetDockTo('spawns');
    expect(useLayoutStore.getState().dockLocation.spawns).toBe(DEFAULT_DOCK_LOCATION.spawns);
  });
});

describe('layoutStore — resetLayout', () => {
  it('restores defaults and wipes panel.* window keys, keeps utility window keys', async () => {
    const { useLayoutStore, DEFAULT_DOCK_LOCATION, DEFAULT_PANEL_ORDER } = await loadStore();
    // Pollute storage: a panel-level floating window AND a utility window.
    localStorage.setItem('scry.windowPos.panel.spawns', '{"x":10,"y":20}');
    localStorage.setItem('scry.windowSize.panel.spawns', '{"w":300,"h":400}');
    localStorage.setItem('scry.windowPos.loot', '{"x":50,"y":60}');
    localStorage.setItem('scry.windowSize.loot', '{"w":320,"h":380}');
    // Mutate state.
    useLayoutStore.getState().dockToSlot('spawns', 'right', 0);
    useLayoutStore.setState({ railWidths: { left: 500, right: 500 }, leftSplit: 0.7 });

    useLayoutStore.getState().resetLayout();

    const s = useLayoutStore.getState();
    expect(s.dockLocation).toEqual(DEFAULT_DOCK_LOCATION);
    expect(s.panelOrder).toEqual(DEFAULT_PANEL_ORDER);
    expect(s.railWidths).toEqual({ left: 320, right: 320 });
    expect(s.leftSplit).toBe(0.55);
    // Panel-level keys gone, utility window keys preserved.
    expect(localStorage.getItem('scry.windowPos.panel.spawns')).toBeNull();
    expect(localStorage.getItem('scry.windowSize.panel.spawns')).toBeNull();
    expect(localStorage.getItem('scry.windowPos.loot')).not.toBeNull();
    expect(localStorage.getItem('scry.windowSize.loot')).not.toBeNull();
  });
});

describe('layoutStore — railCollapsed', () => {
  it('defaults to neither rail collapsed', async () => {
    const { useLayoutStore } = await loadStore();
    expect(useLayoutStore.getState().railCollapsed).toEqual({ left: false, right: false });
  });

  it('toggleRailCollapsed flips one side and persists it', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().toggleRailCollapsed('left');
    expect(useLayoutStore.getState().railCollapsed).toEqual({ left: true, right: false });
    const persisted = JSON.parse(localStorage.getItem('scry.layout') ?? '{}');
    expect(persisted.state.railCollapsed.left).toBe(true);
  });

  it('setRailCollapsed sets an explicit value', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().setRailCollapsed('right', true);
    expect(useLayoutStore.getState().railCollapsed.right).toBe(true);
    useLayoutStore.getState().setRailCollapsed('right', false);
    expect(useLayoutStore.getState().railCollapsed.right).toBe(false);
  });

  it('resetLayout clears collapse back to defaults', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().setRailCollapsed('left', true);
    useLayoutStore.getState().resetLayout();
    expect(useLayoutStore.getState().railCollapsed).toEqual({ left: false, right: false });
  });
});

// Reference exists so the import-graph stays alive even if we delete a
// leaf test above — keeps tooling from yelling about an unused symbol.
void SCRY_KEYS;
