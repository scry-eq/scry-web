import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { FILTERS } from '@/ui/filterflags';

// Audio-alert preferences. Distinct from prefsStore (UI behavior) and
// layoutStore (panel docking) so its persistence shape can evolve
// without dragging the others' migrations along.
//
// Two cue families:
//   - filter-flag cues: one per FILTERS index. Fired on `spawnAdded`
//     when the new spawn's filterFlags bitmask matches.
//   - buff-fading: a single cue that fires once when any active buff
//     crosses below `buffWarningSecs` of remaining duration.
//
// Each cue carries an `enabled` bit and a per-cue `volume` (0..1).
// Master volume + master mute apply on top of the per-cue volume.
//
// Defaults: only `danger` and `buffFading` are on out of the box —
// matches the "high-signal cues only" UX choice; the user opts the rest
// in via the Alerts settings tab.

// Stable string keys that map to /sounds/<key>.wav. Kept in lockstep
// with FILTERS by index — adding a new filter type needs a new wav AND
// a new entry here. The buff cue is a separate constant.
export const FILTER_CUE_KEYS = ['hunt', 'caution', 'danger', 'locate', 'alert', 'filtered', 'tracer'] as const;
export type FilterCueKey = typeof FILTER_CUE_KEYS[number];
export const BUFF_FADING_CUE: 'buff-fading' = 'buff-fading';

export type CueState = {
  enabled: boolean;
  // Per-cue gain. Persists across the master mute toggle so the user
  // doesn't lose a relative balance just by muting.
  volume: number;
};

interface AlertsState {
  muted: boolean;
  masterVolume: number;            // 0..1
  filterCues: Record<FilterCueKey, CueState>;
  buffWarning: CueState;
  // Seconds-remaining threshold below which an active buff fires the
  // buff-fading cue. Only fires once per (spellId, buffSession).
  buffWarningSecs: number;

  // Non-audio output channels for the same alerts. Both are gated only by
  // their own master toggle — deliberately independent of `muted`/per-cue
  // `enabled` so "silent visual toasts" and "speak even with sound off"
  // both work. Toasts default on; speech (the most intrusive channel)
  // defaults off.
  toastsEnabled: boolean;
  speechEnabled: boolean;
  speechVolume: number;            // 0..1
  speechRate: number;              // 0.5..2 (SpeechSynthesisUtterance.rate)

  setMuted: (v: boolean) => void;
  setMasterVolume: (v: number) => void;
  setFilterCueEnabled: (key: FilterCueKey, v: boolean) => void;
  setFilterCueVolume:  (key: FilterCueKey, v: number) => void;
  setBuffWarningEnabled: (v: boolean) => void;
  setBuffWarningVolume:  (v: number) => void;
  setBuffWarningSecs:    (v: number) => void;
  setToastsEnabled: (v: boolean) => void;
  setSpeechEnabled: (v: boolean) => void;
  setSpeechVolume:  (v: number) => void;
  setSpeechRate:    (v: number) => void;
  resetAlerts: () => void;
}

// Filtered/Tracer have no row tint by design (filterflags.ts) and are
// hide/debug categories rather than "look at me" states — so they ship
// as off-with-a-low-volume defaults. Power users can flip them on.
const DEFAULT_FILTER_CUES: Record<FilterCueKey, CueState> = {
  hunt:     { enabled: false, volume: 0.7 },
  caution:  { enabled: false, volume: 0.7 },
  danger:   { enabled: false, volume: 0.9 },
  locate:   { enabled: false, volume: 0.6 },
  alert:    { enabled: true,  volume: 0.7 },
  filtered: { enabled: false, volume: 0.5 },
  tracer:   { enabled: false, volume: 0.5 },
};

const DEFAULT_BUFF_WARNING: CueState = { enabled: true, volume: 0.7 };
const DEFAULT_BUFF_WARNING_SECS = 30;

const DEFAULT_TOASTS_ENABLED = true;
const DEFAULT_SPEECH_ENABLED = false;
const DEFAULT_SPEECH_VOLUME = 1;
const DEFAULT_SPEECH_RATE = 1;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
// SpeechSynthesisUtterance.rate is spec'd for [0.1, 10]; clamp to a sane
// [0.5, 2] so a slider mishap can't produce unintelligible speech.
const clampRate = (v: number) => Math.max(0.5, Math.min(2, v));

const jsonStorage: PersistStorage<unknown> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      return raw ? (JSON.parse(raw) as StorageValue<unknown>) : null;
    } catch { return null; }
  },
  setItem: (name, value) => {
    try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* ignore */ }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set) => ({
      muted: false,
      masterVolume: 0.8,
      filterCues: { ...DEFAULT_FILTER_CUES },
      buffWarning: { ...DEFAULT_BUFF_WARNING },
      buffWarningSecs: DEFAULT_BUFF_WARNING_SECS,
      toastsEnabled: DEFAULT_TOASTS_ENABLED,
      speechEnabled: DEFAULT_SPEECH_ENABLED,
      speechVolume: DEFAULT_SPEECH_VOLUME,
      speechRate: DEFAULT_SPEECH_RATE,

      setMuted:        (v) => set({ muted: v }),
      setMasterVolume: (v) => set({ masterVolume: clamp01(v) }),
      setFilterCueEnabled: (key, v) =>
        set((s) => ({ filterCues: { ...s.filterCues, [key]: { ...s.filterCues[key], enabled: v } } })),
      setFilterCueVolume: (key, v) =>
        set((s) => ({ filterCues: { ...s.filterCues, [key]: { ...s.filterCues[key], volume: clamp01(v) } } })),
      setBuffWarningEnabled: (v) =>
        set((s) => ({ buffWarning: { ...s.buffWarning, enabled: v } })),
      setBuffWarningVolume: (v) =>
        set((s) => ({ buffWarning: { ...s.buffWarning, volume: clamp01(v) } })),
      setBuffWarningSecs: (v) => {
        const n = Math.max(5, Math.min(300, Math.round(v)));
        set({ buffWarningSecs: n });
      },
      setToastsEnabled: (v) => set({ toastsEnabled: v }),
      setSpeechEnabled: (v) => set({ speechEnabled: v }),
      setSpeechVolume:  (v) => set({ speechVolume: clamp01(v) }),
      setSpeechRate:    (v) => set({ speechRate: clampRate(v) }),
      resetAlerts: () => set({
        muted: false,
        masterVolume: 0.8,
        filterCues: { ...DEFAULT_FILTER_CUES },
        buffWarning: { ...DEFAULT_BUFF_WARNING },
        buffWarningSecs: DEFAULT_BUFF_WARNING_SECS,
        toastsEnabled: DEFAULT_TOASTS_ENABLED,
        speechEnabled: DEFAULT_SPEECH_ENABLED,
        speechVolume: DEFAULT_SPEECH_VOLUME,
        speechRate: DEFAULT_SPEECH_RATE,
      }),
    }),
    {
      name: 'scry.alerts',
      version: 1,
      storage: jsonStorage,
      partialize: (state) => ({
        muted: state.muted,
        masterVolume: state.masterVolume,
        filterCues: state.filterCues,
        buffWarning: state.buffWarning,
        buffWarningSecs: state.buffWarningSecs,
        toastsEnabled: state.toastsEnabled,
        speechEnabled: state.speechEnabled,
        speechVolume: state.speechVolume,
        speechRate: state.speechRate,
      }),
      // Backfill defaults if the persisted shape is missing keys we've
      // since added (e.g. a new filter type). Without this, freshly-
      // added cues are `undefined` until reset.
      merge: (persisted, current) => {
        const p = persisted as Partial<AlertsState> | undefined;
        return {
          ...current,
          ...(p ?? {}),
          filterCues: { ...current.filterCues, ...(p?.filterCues ?? {}) },
          buffWarning: { ...current.buffWarning, ...(p?.buffWarning ?? {}) },
        };
      },
    },
  ),
);

// Map a FILTERS index to its cue key. The two arrays are aligned by
// design — see FILTER_CUE_KEYS.
export function filterCueKeyForIndex(idx: number): FilterCueKey | undefined {
  return FILTER_CUE_KEYS[idx];
}

// Convert a Spawn's filter_flags bitmask into the *highest priority*
// matching cue key, mirroring tintForFilterFlags' priority order so the
// audible cue agrees with the row tint. Returns undefined when no flag
// matches a cue.
export function cueKeyForFilterFlags(flags: number): FilterCueKey | undefined {
  // Same priority list as filterflags.ts FILTER_ROW_TINT.
  const priority: FilterCueKey[] = ['danger', 'caution', 'alert', 'hunt', 'locate'];
  for (const key of priority) {
    const idx = FILTER_CUE_KEYS.indexOf(key);
    if (idx < 0) continue;
    const bit = FILTERS[idx]?.bit ?? 0;
    if (flags & bit) return key;
  }
  return undefined;
}
