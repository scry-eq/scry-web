import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';

// User-tunable behavioral toggles. Distinct from layoutStore (panel
// positioning) — these affect how packets drive selection and how the
// map animates. Persisted to `scry.prefs`; initial state reads the
// legacy per-toggle keys once so existing installs migrate cleanly.

interface PrefsState {
  selectOnConsider: boolean;
  selectOnTarget: boolean;
  deselectOnUntarget: boolean;
  trackPlayer: boolean;
  smoothMovement: boolean;
  // Variant of smoothMovement: when set (and smoothMovement is on), the map
  // extrapolates each spawn forward along its reported velocity vector
  // (dead reckoning) instead of easing toward the last-reported position.
  // See PosSmoother in MapCanvas.tsx. No-op while smoothMovement is off.
  predictiveMovement: boolean;
  // Map height filter: derive the band from the zone instead of the Above/Below
  // inputs, and fade geometry out of the band instead of clipping it. See
  // lib/mapZ.ts — both mirror the EQ client's Auto Z / Fade map controls.
  mapAutoZ: boolean;
  mapZFade: boolean;
  /** Residual opacity floor for mapZFade, 0..100. No-op while mapZFade is off. */
  mapZFadePercent: number;

  setSelectOnConsider: (v: boolean) => void;
  setSelectOnTarget: (v: boolean) => void;
  setDeselectOnUntarget: (v: boolean) => void;
  setTrackPlayer: (v: boolean) => void;
  setSmoothMovement: (v: boolean) => void;
  setPredictiveMovement: (v: boolean) => void;
  setMapAutoZ: (v: boolean) => void;
  setMapZFade: (v: boolean) => void;
  setMapZFadePercent: (v: number) => void;
}

function readLegacyBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

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

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      selectOnConsider:    readLegacyBool('scry.selectOnConsider', false),
      selectOnTarget:      readLegacyBool('scry.selectOnTarget', false),
      deselectOnUntarget:  readLegacyBool('scry.deselectOnUntarget', false),
      trackPlayer:         readLegacyBool('scry.trackPlayer', false),
      smoothMovement:      readLegacyBool('scry.smoothMovement', true),
      predictiveMovement:  readLegacyBool('scry.predictiveMovement', false),
      mapAutoZ:            false,
      mapZFade:            false,
      mapZFadePercent:     20,

      setSelectOnConsider:    (v) => set({ selectOnConsider: v }),
      setSelectOnTarget:      (v) => set({ selectOnTarget: v }),
      setDeselectOnUntarget:  (v) => set({ deselectOnUntarget: v }),
      setTrackPlayer:         (v) => set({ trackPlayer: v }),
      setSmoothMovement:      (v) => set({ smoothMovement: v }),
      setPredictiveMovement:  (v) => set({ predictiveMovement: v }),
      setMapAutoZ:            (v) => set({ mapAutoZ: v }),
      setMapZFade:            (v) => set({ mapZFade: v }),
      setMapZFadePercent:     (v) => set({ mapZFadePercent: Math.min(100, Math.max(0, Math.round(v))) }),
    }),
    {
      name: 'scry.prefs',
      version: 1,
      storage: jsonStorage,
      partialize: (state) => ({
        selectOnConsider:    state.selectOnConsider,
        selectOnTarget:      state.selectOnTarget,
        deselectOnUntarget:  state.deselectOnUntarget,
        trackPlayer:         state.trackPlayer,
        smoothMovement:      state.smoothMovement,
        predictiveMovement:  state.predictiveMovement,
        mapAutoZ:            state.mapAutoZ,
        mapZFade:            state.mapZFade,
        mapZFadePercent:     state.mapZFadePercent,
      }),
    },
  ),
);
