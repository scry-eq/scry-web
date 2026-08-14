import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return await import('./prefsStore');
}

describe('prefsStore — defaults', () => {
  it('matches the documented defaults when nothing is persisted', async () => {
    const { usePrefsStore } = await loadStore();
    const s = usePrefsStore.getState();
    expect(s.selectOnConsider).toBe(false);
    expect(s.selectOnTarget).toBe(false);
    expect(s.deselectOnUntarget).toBe(false);
    expect(s.trackPlayer).toBe(false);
    // smoothMovement defaults true to match the legacy localPrefs default.
    expect(s.smoothMovement).toBe(true);
    // predictiveMovement is an opt-in variant of smoothing — off by default.
    expect(s.predictiveMovement).toBe(false);
  });
});

describe('prefsStore — legacy migration', () => {
  it('reads "1"/"0" string flags into booleans', async () => {
    localStorage.setItem('scry.selectOnConsider', '1');
    localStorage.setItem('scry.selectOnTarget', '0');
    localStorage.setItem('scry.deselectOnUntarget', '1');
    localStorage.setItem('scry.trackPlayer', '1');
    localStorage.setItem('scry.smoothMovement', '0');
    const { usePrefsStore } = await loadStore();
    const s = usePrefsStore.getState();
    expect(s.selectOnConsider).toBe(true);
    expect(s.selectOnTarget).toBe(false);
    expect(s.deselectOnUntarget).toBe(true);
    expect(s.trackPlayer).toBe(true);
    expect(s.smoothMovement).toBe(false);
  });

  it('treats absent legacy keys as their respective defaults', async () => {
    // Only one is set — the rest should fall through to defaults
    // (smoothMovement true, others false).
    localStorage.setItem('scry.selectOnTarget', '1');
    const { usePrefsStore } = await loadStore();
    const s = usePrefsStore.getState();
    expect(s.selectOnTarget).toBe(true);
    expect(s.selectOnConsider).toBe(false);
    expect(s.smoothMovement).toBe(true);
  });
});

describe('prefsStore — actions', () => {
  it('each setter flips state', async () => {
    const { usePrefsStore } = await loadStore();
    const s = usePrefsStore.getState();
    s.setSelectOnConsider(true);
    s.setSelectOnTarget(true);
    s.setDeselectOnUntarget(true);
    s.setTrackPlayer(true);
    s.setSmoothMovement(false);
    s.setPredictiveMovement(true);
    const after = usePrefsStore.getState();
    expect(after.selectOnConsider).toBe(true);
    expect(after.selectOnTarget).toBe(true);
    expect(after.deselectOnUntarget).toBe(true);
    expect(after.trackPlayer).toBe(true);
    expect(after.smoothMovement).toBe(false);
    expect(after.predictiveMovement).toBe(true);
  });

  it('persists state changes into scry.prefs', async () => {
    const { usePrefsStore } = await loadStore();
    usePrefsStore.getState().setTrackPlayer(true);
    const persisted = JSON.parse(localStorage.getItem('scry.prefs') ?? '{}');
    expect(persisted.state.trackPlayer).toBe(true);
    // partialize should *not* persist actions
    expect(persisted.state.setTrackPlayer).toBeUndefined();
  });

  it('rehydrates from scry.prefs on next load', async () => {
    // Write a "previous session" persisted blob, then reload module.
    localStorage.setItem('scry.prefs', JSON.stringify({
      state: {
        selectOnConsider: true,
        selectOnTarget: false,
        deselectOnUntarget: true,
        trackPlayer: false,
        smoothMovement: false,
      },
      version: 1,
    }));
    const { usePrefsStore } = await loadStore();
    const s = usePrefsStore.getState();
    expect(s.selectOnConsider).toBe(true);
    expect(s.deselectOnUntarget).toBe(true);
    expect(s.smoothMovement).toBe(false);
  });
});
