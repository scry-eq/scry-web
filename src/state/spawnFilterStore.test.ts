import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpawnType } from '../gen/seq/v1/events_pb';

// The store persists to scry.spawnFilters and hydrates at module load, so
// we reset modules + clear storage per test to get a fresh default store.
function clearStorage() {
  for (const k of [...Object.keys(localStorage)]) {
    if (k.startsWith('scry.')) localStorage.removeItem(k);
  }
}
beforeEach(() => {
  clearStorage();
  vi.resetModules();
});
afterEach(() => {
  clearStorage();
});

async function load() {
  return await import('./spawnFilterStore');
}

const baseSpawn = {
  type: SpawnType.NPC,
  level: 30,
  filterFlags: 0,
  categoryIds: [] as number[],
  name: 'a guard',
  lastName: '',
};

const allPass = {
  categoryFilter: -1,
  hideFiltered: true,
  nameFilter: '',
  levelMin: 0,
  levelMax: 0,
  levelRelative: false,
  levelRelLow: -3,
  levelRelHigh: 3,
  playerLevel: 0,
  types: { npc: true, pc: true, corpse: true },
};

describe('passesSpawnFilter — level band', () => {
  it('passes within the band, fails outside', async () => {
    const { passesSpawnFilter } = await load();
    const band = { ...allPass, levelMin: 20, levelMax: 40 };
    expect(passesSpawnFilter({ ...baseSpawn, level: 30 }, band)).toBe(true);
    expect(passesSpawnFilter({ ...baseSpawn, level: 10 }, band)).toBe(false);
    expect(passesSpawnFilter({ ...baseSpawn, level: 50 }, band)).toBe(false);
  });
  it('treats a 0 bound as unbounded on that side', async () => {
    const { passesSpawnFilter } = await load();
    expect(passesSpawnFilter({ ...baseSpawn, level: 1 }, allPass)).toBe(true);
    expect(passesSpawnFilter({ ...baseSpawn, level: 1 }, { ...allPass, levelMax: 5 })).toBe(true);
    expect(passesSpawnFilter({ ...baseSpawn, level: 9 }, { ...allPass, levelMax: 5 })).toBe(false);
  });
});

describe('passesSpawnFilter — relative level band (±Me)', () => {
  const rel = (over: Partial<typeof allPass> = {}) => ({
    ...allPass,
    levelRelative: true,
    levelRelLow: -3,
    levelRelHigh: 3,
    playerLevel: 30,
    ...over,
  });
  it('resolves offsets against the live player level', async () => {
    const { passesSpawnFilter } = await load();
    const st = rel();
    expect(passesSpawnFilter({ ...baseSpawn, level: 30 }, st)).toBe(true);
    expect(passesSpawnFilter({ ...baseSpawn, level: 27 }, st)).toBe(true);
    expect(passesSpawnFilter({ ...baseSpawn, level: 33 }, st)).toBe(true);
    expect(passesSpawnFilter({ ...baseSpawn, level: 26 }, st)).toBe(false);
    expect(passesSpawnFilter({ ...baseSpawn, level: 34 }, st)).toBe(false);
  });
  it('no-ops when the player level is unknown (0)', async () => {
    const { passesSpawnFilter } = await load();
    const st = rel({ playerLevel: 0 });
    expect(passesSpawnFilter({ ...baseSpawn, level: 1 }, st)).toBe(true);
    expect(passesSpawnFilter({ ...baseSpawn, level: 60 }, st)).toBe(true);
  });
  it('ignores the absolute bounds while relative mode is on', async () => {
    const { passesSpawnFilter } = await load();
    const st = rel({ levelMin: 1, levelMax: 5, levelRelLow: -2, levelRelHigh: 2, playerLevel: 40 });
    expect(passesSpawnFilter({ ...baseSpawn, level: 40 }, st)).toBe(true); // would fail abs 1-5
    expect(passesSpawnFilter({ ...baseSpawn, level: 3 }, st)).toBe(false); // inside abs, outside rel
  });
});

describe('passesSpawnFilter — type buckets', () => {
  it('hides a bucket when its toggle is off', async () => {
    const { passesSpawnFilter } = await load();
    const hideNpc = { ...allPass, types: { npc: false, pc: true, corpse: true } };
    expect(passesSpawnFilter({ ...baseSpawn, type: SpawnType.NPC }, hideNpc)).toBe(false);
    expect(passesSpawnFilter({ ...baseSpawn, type: SpawnType.PC }, hideNpc)).toBe(true);
  });
  it('maps both corpse variants into the corpse bucket', async () => {
    const { passesSpawnFilter, spawnTypeBucket } = await load();
    expect(spawnTypeBucket(SpawnType.CORPSE_PC)).toBe('corpse');
    expect(spawnTypeBucket(SpawnType.CORPSE_NPC)).toBe('corpse');
    const hideCorpse = { ...allPass, types: { npc: true, pc: true, corpse: false } };
    expect(passesSpawnFilter({ ...baseSpawn, type: SpawnType.CORPSE_PC }, hideCorpse)).toBe(false);
    expect(passesSpawnFilter({ ...baseSpawn, type: SpawnType.CORPSE_NPC }, hideCorpse)).toBe(false);
  });
  it('always drops DOOR and DROP scenery', async () => {
    const { passesSpawnFilter } = await load();
    expect(passesSpawnFilter({ ...baseSpawn, type: SpawnType.DOOR }, allPass)).toBe(false);
    expect(passesSpawnFilter({ ...baseSpawn, type: SpawnType.DROP }, allPass)).toBe(false);
  });
});

describe('spawnFilterStore — level setters', () => {
  it('clamps negatives and NaN to 0 (unbounded)', async () => {
    const { useSpawnFilterStore } = await load();
    const s = () => useSpawnFilterStore.getState();
    s().setLevelMin(-5);
    expect(s().levelMin).toBe(0);
    s().setLevelMin(Number.NaN);
    expect(s().levelMin).toBe(0);
    s().setLevelMax(54);
    expect(s().levelMax).toBe(54);
  });
});

describe('spawnFilterStore — presets', () => {
  it('saves current values, restores them on apply, removes on delete', async () => {
    const { useSpawnFilterStore } = await load();
    const s = () => useSpawnFilterStore.getState();
    s().setLevelMin(15);
    s().setLevelMax(54);
    s().setLevelRelative(true);
    s().setLevelRelLow(-4);
    s().setTypeVisible('pc', false);
    s().savePreset('hunt');

    // Drift away from the saved values…
    s().resetAdvancedFilters();
    expect(s().levelMin).toBe(0);
    expect(s().types.pc).toBe(true);

    // …then re-apply to restore them.
    s().applyPreset('hunt');
    expect(s().levelMin).toBe(15);
    expect(s().levelMax).toBe(54);
    expect(s().types.pc).toBe(false);
    expect(s().levelRelative).toBe(true);
    expect(s().levelRelLow).toBe(-4);

    s().deletePreset('hunt');
    expect(s().presets).toHaveLength(0);
  });

  it('a preset snapshot does not alias the live types object', async () => {
    const { useSpawnFilterStore } = await load();
    const s = () => useSpawnFilterStore.getState();
    s().setTypeVisible('corpse', false);
    s().savePreset('p');
    s().setTypeVisible('corpse', true); // change the live store after saving
    s().applyPreset('p');
    expect(s().types.corpse).toBe(false); // preset kept its own snapshot
  });

  it('re-saving a name overwrites rather than duplicating', async () => {
    const { useSpawnFilterStore } = await load();
    const s = () => useSpawnFilterStore.getState();
    s().setLevelMin(10);
    s().savePreset('dup');
    s().setLevelMin(20);
    s().savePreset('dup');
    expect(s().presets).toHaveLength(1);
    expect(s().presets[0].values.levelMin).toBe(20);
  });

  it('ignores a blank preset name', async () => {
    const { useSpawnFilterStore } = await load();
    const s = () => useSpawnFilterStore.getState();
    s().savePreset('   ');
    expect(s().presets).toHaveLength(0);
  });
});
