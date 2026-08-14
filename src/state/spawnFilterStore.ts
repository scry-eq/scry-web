import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SpawnType } from '../gen/seq/v1/events_pb';

// Shared spawn-filter state for SpawnList + MapCanvas. Both surfaces apply
// the same `passesSpawnFilter` predicate so map dots mirror list rows.
// MapCanvas passes the whole store object as the predicate state, so any
// field added here is honored on the map automatically (no MapCanvas edit).
//
// Persisted (scry.spawnFilters) so view filters AND named presets survive
// reloads. Named presets let players keep reusable setups ("named only",
// "hunt list") and re-apply them in one click.
//
//   categoryFilter:  -1 = "All spawns", else a CategoryMgr id
//   hideFiltered:    true = drop spawns with FILTERED_BIT in filterFlags
//   nameFilter:      substring match against "name + lastName" (case-insensitive)
//   levelMin/Max:    absolute level band; 0 on either side = unbounded
//   levelRelative:   when true the band is relative to YOUR level instead,
//                    using levelRelLow/High as signed offsets (Me-3 … Me+5)
//   levelRelLow/High signed offsets applied to playerLevel in relative mode
//   playerLevel:     live, non-persisted — App syncs it each tick so the
//                    relative band can resolve. 0 = unknown → relative no-ops
//   types:           per-bucket visibility (npc / pc / corpse)
//
// (The map's Z-window "height filter" is separate, MapCanvas-local state.)
//
// Selection does NOT pierce these filters — the user explicitly wants those
// spawns hidden across both surfaces. (The map height filter still pierces;
// that's its own predicate inside MapCanvas.)

export type SpawnTypeFilters = { npc: boolean; pc: boolean; corpse: boolean };

export const ALL_TYPES: SpawnTypeFilters = { npc: true, pc: true, corpse: true };

// The subset of filter values a preset captures and that we persist live.
// (playerLevel is deliberately NOT here — it's live state, not config.)
export interface FilterValues {
  categoryFilter: number;
  hideFiltered: boolean;
  nameFilter: string;
  levelMin: number;
  levelMax: number;
  levelRelative: boolean;
  levelRelLow: number;
  levelRelHigh: number;
  types: SpawnTypeFilters;
}

export interface FilterPreset {
  name: string;
  values: FilterValues;
}

interface SpawnFilterState extends FilterValues {
  presets: FilterPreset[];
  // Live player level, synced by App; drives the relative level band. Not
  // persisted, not part of presets.
  playerLevel: number;

  setCategoryFilter: (v: number) => void;
  setHideFiltered: (v: boolean) => void;
  setNameFilter: (v: string) => void;
  setLevelMin: (v: number) => void;
  setLevelMax: (v: number) => void;
  setLevelRelative: (v: boolean) => void;
  setLevelRelLow: (v: number) => void;
  setLevelRelHigh: (v: number) => void;
  setTypeVisible: (k: keyof SpawnTypeFilters, v: boolean) => void;
  setPlayerLevel: (v: number) => void;
  resetAdvancedFilters: () => void;
  savePreset: (name: string) => void;
  applyPreset: (name: string) => void;
  deletePreset: (name: string) => void;
}

const DEFAULT_REL_LOW = -3;
const DEFAULT_REL_HIGH = 3;

const DEFAULTS: FilterValues = {
  categoryFilter: -1,
  hideFiltered: true,
  nameFilter: '',
  levelMin: 0,
  levelMax: 0,
  levelRelative: false,
  levelRelLow: DEFAULT_REL_LOW,
  levelRelHigh: DEFAULT_REL_HIGH,
  types: { ...ALL_TYPES },
};

// Clone the filter values (so a preset's `types` object can't alias the live
// store's, which would make later edits leak into the saved snapshot).
const snapshot = (s: FilterValues): FilterValues => ({
  categoryFilter: s.categoryFilter,
  hideFiltered: s.hideFiltered,
  nameFilter: s.nameFilter,
  levelMin: s.levelMin,
  levelMax: s.levelMax,
  levelRelative: s.levelRelative,
  levelRelLow: s.levelRelLow,
  levelRelHigh: s.levelRelHigh,
  types: { ...s.types },
});

const clampLevel = (v: number) => {
  const n = Math.floor(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
// Relative offsets are signed; clamp to a sane range so a stray keypress
// can't push the band absurdly far.
const clampOffset = (v: number) => {
  const n = Math.floor(v);
  return Number.isFinite(n) ? Math.max(-127, Math.min(127, n)) : 0;
};

export const useSpawnFilterStore = create<SpawnFilterState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      presets: [],
      playerLevel: 0,

      setCategoryFilter: (v) => set({ categoryFilter: v }),
      setHideFiltered: (v) => set({ hideFiltered: v }),
      setNameFilter: (v) => set({ nameFilter: v }),
      setLevelMin: (v) => set({ levelMin: clampLevel(v) }),
      setLevelMax: (v) => set({ levelMax: clampLevel(v) }),
      setLevelRelative: (v) => set({ levelRelative: v }),
      setLevelRelLow: (v) => set({ levelRelLow: clampOffset(v) }),
      setLevelRelHigh: (v) => set({ levelRelHigh: clampOffset(v) }),
      setTypeVisible: (k, v) => set((s) => ({ types: { ...s.types, [k]: v } })),
      setPlayerLevel: (v) => set({ playerLevel: v }),

      // Reset only the "advanced" view filters (level + type). Category and
      // name keep their own always-visible controls, so a "Clear" in the
      // advanced panel shouldn't blow those away.
      resetAdvancedFilters: () =>
        set({
          levelMin: 0,
          levelMax: 0,
          levelRelative: false,
          levelRelLow: DEFAULT_REL_LOW,
          levelRelHigh: DEFAULT_REL_HIGH,
          types: { ...ALL_TYPES },
        }),

      savePreset: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const values = snapshot(get());
        set((s) => ({
          presets: [
            ...s.presets.filter((p) => p.name !== trimmed),
            { name: trimmed, values },
          ].sort((a, b) => a.name.localeCompare(b.name)),
        }));
      },
      applyPreset: (name) => {
        const p = get().presets.find((x) => x.name === name);
        if (p) set(snapshot(p.values));
      },
      deletePreset: (name) =>
        set((s) => ({ presets: s.presets.filter((p) => p.name !== name) })),
    }),
    {
      name: 'scry.spawnFilters',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist the filter values + presets only; actions and the live
      // playerLevel stay on the store but don't round-trip.
      partialize: (s) => ({ ...snapshot(s), presets: s.presets }),
      // Tolerate snapshots written before newer fields existed.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<FilterValues> & { presets?: FilterPreset[] };
        return {
          ...current,
          ...p,
          types: { ...ALL_TYPES, ...(p.types ?? {}) },
          presets: Array.isArray(p.presets) ? p.presets : [],
        };
      },
    },
  ),
);

// Shared `passesSpawnFilter` predicate. Returns true if the spawn should be
// visible given the current filter state. DOOR/DROP are excluded
// unconditionally (scenery, not actors). The caller handles the
// selected-spawn pierce for the map height filter; this predicate does not
// pierce.

export const FILTERED_BIT = 1 << 5;

export interface FilterableSpawn {
  type: number;
  level: number;
  filterFlags: number;
  categoryIds: number[];
  name?: string;
  lastName?: string;
}

// Collapse the wire SpawnType values into the buckets the type filter
// exposes. SPAWN_UNSPECIFIED rides as "other" (always shown). DOOR/DROP
// never reach here (excluded in the predicate). There is no PET type on the
// wire, so pets fall under NPC.
export function spawnTypeBucket(t: number): keyof SpawnTypeFilters | 'other' {
  switch (t) {
    case SpawnType.PC:
      return 'pc';
    case SpawnType.CORPSE_PC:
    case SpawnType.CORPSE_NPC:
      return 'corpse';
    case SpawnType.NPC:
      return 'npc';
    default:
      return 'other';
  }
}

export type SpawnFilterPredicateState = {
  categoryFilter: number;
  hideFiltered: boolean;
  nameFilter: string;
  levelMin: number;
  levelMax: number;
  levelRelative: boolean;
  levelRelLow: number;
  levelRelHigh: number;
  playerLevel: number;
  types: SpawnTypeFilters;
};

// Resolve the effective absolute [min,max] level band. In relative mode the
// offsets are applied to the live player level; if that's unknown (0) the
// band is disabled so we don't accidentally hide everything pre-zone-in.
// Returns 0 for an unbounded side (matching the absolute-mode convention).
export function resolveLevelBand(
  state: Pick<
    SpawnFilterPredicateState,
    'levelMin' | 'levelMax' | 'levelRelative' | 'levelRelLow' | 'levelRelHigh' | 'playerLevel'
  >,
): { min: number; max: number } {
  if (state.levelRelative) {
    const pl = state.playerLevel;
    if (!pl || pl <= 0) return { min: 0, max: 0 };
    return {
      min: Math.max(0, pl + state.levelRelLow),
      max: Math.max(0, pl + state.levelRelHigh),
    };
  }
  return { min: state.levelMin, max: state.levelMax };
}

export function passesSpawnFilter(
  s: FilterableSpawn,
  state: SpawnFilterPredicateState,
): boolean {
  if (s.type === SpawnType.DOOR || s.type === SpawnType.DROP) return false;
  if ((s.name ?? '').toLowerCase().endsWith("'s mount")) return false;
  if (state.hideFiltered && (s.filterFlags & FILTERED_BIT) !== 0) return false;
  const bucket = spawnTypeBucket(s.type);
  if (bucket !== 'other' && !state.types[bucket]) return false;
  const { min, max } = resolveLevelBand(state);
  if (min > 0 && s.level < min) return false;
  if (max > 0 && s.level > max) return false;
  if (state.categoryFilter >= 0 && !s.categoryIds.includes(state.categoryFilter)) return false;
  const needle = state.nameFilter.trim().toLowerCase();
  if (needle) {
    const hay = `${s.name ?? ''} ${s.lastName ?? ''}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}
