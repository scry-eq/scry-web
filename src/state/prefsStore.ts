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

  setSelectOnConsider: (v: boolean) => void;
  setSelectOnTarget: (v: boolean) => void;
  setDeselectOnUntarget: (v: boolean) => void;
  setTrackPlayer: (v: boolean) => void;
  setSmoothMovement: (v: boolean) => void;
  setPredictiveMovement: (v: boolean) => void;
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

      setSelectOnConsider:    (v) => set({ selectOnConsider: v }),
      setSelectOnTarget:      (v) => set({ selectOnTarget: v }),
      setDeselectOnUntarget:  (v) => set({ deselectOnUntarget: v }),
      setTrackPlayer:         (v) => set({ trackPlayer: v }),
      setSmoothMovement:      (v) => set({ smoothMovement: v }),
      setPredictiveMovement:  (v) => set({ predictiveMovement: v }),
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
      }),
    },
  ),
);
