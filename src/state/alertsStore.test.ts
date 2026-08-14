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
  return await import('./alertsStore');
}

describe('alertsStore — defaults', () => {
  it('matches the high-signal-only default policy', async () => {
    const { useAlertsStore } = await loadStore();
    const s = useAlertsStore.getState();
    expect(s.muted).toBe(false);
    expect(s.masterVolume).toBeCloseTo(0.8);
    // Only Alert and buff-fading are on by default.
    expect(s.filterCues.alert.enabled).toBe(true);
    expect(s.buffWarning.enabled).toBe(true);
    for (const k of ['hunt', 'caution', 'danger', 'locate', 'filtered', 'tracer'] as const) {
      expect(s.filterCues[k].enabled).toBe(false);
    }
    expect(s.buffWarningSecs).toBe(30);
  });
});

describe('alertsStore — actions', () => {
  it('clamps master volume to 0..1', async () => {
    const { useAlertsStore } = await loadStore();
    useAlertsStore.getState().setMasterVolume(2);
    expect(useAlertsStore.getState().masterVolume).toBe(1);
    useAlertsStore.getState().setMasterVolume(-3);
    expect(useAlertsStore.getState().masterVolume).toBe(0);
  });

  it('clamps buff threshold seconds to 5..300', async () => {
    const { useAlertsStore } = await loadStore();
    useAlertsStore.getState().setBuffWarningSecs(2);
    expect(useAlertsStore.getState().buffWarningSecs).toBe(5);
    useAlertsStore.getState().setBuffWarningSecs(9999);
    expect(useAlertsStore.getState().buffWarningSecs).toBe(300);
    useAlertsStore.getState().setBuffWarningSecs(45.7);
    expect(useAlertsStore.getState().buffWarningSecs).toBe(46);
  });

  it('flips per-cue enable + volume independently', async () => {
    const { useAlertsStore } = await loadStore();
    useAlertsStore.getState().setFilterCueEnabled('hunt', true);
    useAlertsStore.getState().setFilterCueVolume('hunt', 0.5);
    const s = useAlertsStore.getState();
    expect(s.filterCues.hunt.enabled).toBe(true);
    expect(s.filterCues.hunt.volume).toBeCloseTo(0.5);
    // Untouched cues keep their defaults.
    expect(s.filterCues.alert.enabled).toBe(true);
    expect(s.filterCues.locate.enabled).toBe(false);
  });

  it('resetAlerts restores defaults', async () => {
    const { useAlertsStore } = await loadStore();
    useAlertsStore.getState().setMuted(true);
    useAlertsStore.getState().setFilterCueEnabled('hunt', true);
    useAlertsStore.getState().setBuffWarningSecs(120);
    useAlertsStore.getState().resetAlerts();
    const s = useAlertsStore.getState();
    expect(s.muted).toBe(false);
    expect(s.filterCues.hunt.enabled).toBe(false);
    expect(s.buffWarningSecs).toBe(30);
  });
});

describe('cueKeyForFilterFlags', () => {
  it('honors Danger > Caution > Alert > Hunt > Locate priority', async () => {
    const { cueKeyForFilterFlags } = await loadStore();
    const HUNT = 1 << 0;
    const CAUTION = 1 << 1;
    const DANGER = 1 << 2;
    const LOCATE = 1 << 3;
    const ALERT = 1 << 4;
    expect(cueKeyForFilterFlags(0)).toBeUndefined();
    expect(cueKeyForFilterFlags(HUNT)).toBe('hunt');
    expect(cueKeyForFilterFlags(LOCATE)).toBe('locate');
    expect(cueKeyForFilterFlags(HUNT | CAUTION)).toBe('caution');
    expect(cueKeyForFilterFlags(HUNT | DANGER | LOCATE)).toBe('danger');
    expect(cueKeyForFilterFlags(ALERT | HUNT)).toBe('alert');
  });
});

describe('alertsStore — notification channels', () => {
  it('defaults: toasts on, speech off, full volume, 1x rate', async () => {
    const { useAlertsStore } = await loadStore();
    const s = useAlertsStore.getState();
    expect(s.toastsEnabled).toBe(true);
    expect(s.speechEnabled).toBe(false);
    expect(s.speechVolume).toBe(1);
    expect(s.speechRate).toBe(1);
  });

  it('clamps speech volume to 0..1 and rate to 0.5..2', async () => {
    const { useAlertsStore } = await loadStore();
    useAlertsStore.getState().setSpeechVolume(5);
    expect(useAlertsStore.getState().speechVolume).toBe(1);
    useAlertsStore.getState().setSpeechVolume(-1);
    expect(useAlertsStore.getState().speechVolume).toBe(0);
    useAlertsStore.getState().setSpeechRate(10);
    expect(useAlertsStore.getState().speechRate).toBe(2);
    useAlertsStore.getState().setSpeechRate(0);
    expect(useAlertsStore.getState().speechRate).toBe(0.5);
  });

  it('toggles enable flags independently', async () => {
    const { useAlertsStore } = await loadStore();
    useAlertsStore.getState().setToastsEnabled(false);
    useAlertsStore.getState().setSpeechEnabled(true);
    const s = useAlertsStore.getState();
    expect(s.toastsEnabled).toBe(false);
    expect(s.speechEnabled).toBe(true);
  });

  it('resetAlerts restores channel defaults', async () => {
    const { useAlertsStore } = await loadStore();
    useAlertsStore.getState().setToastsEnabled(false);
    useAlertsStore.getState().setSpeechEnabled(true);
    useAlertsStore.getState().setSpeechVolume(0.2);
    useAlertsStore.getState().setSpeechRate(1.8);
    useAlertsStore.getState().resetAlerts();
    const s = useAlertsStore.getState();
    expect(s.toastsEnabled).toBe(true);
    expect(s.speechEnabled).toBe(false);
    expect(s.speechVolume).toBe(1);
    expect(s.speechRate).toBe(1);
  });

  it('backfills channel defaults when loading a pre-notification blob', async () => {
    // Existing install whose persisted state predates the toast/speech
    // fields — merge must fill them from defaults, not leave undefined.
    localStorage.setItem('scry.alerts', JSON.stringify({
      state: { masterVolume: 0.3, buffWarningSecs: 60 },
      version: 1,
    }));
    const { useAlertsStore } = await loadStore();
    const s = useAlertsStore.getState();
    // Old fields honored…
    expect(s.masterVolume).toBeCloseTo(0.3);
    expect(s.buffWarningSecs).toBe(60);
    // …new channel fields backfilled from defaults.
    expect(s.toastsEnabled).toBe(true);
    expect(s.speechEnabled).toBe(false);
    expect(s.speechVolume).toBe(1);
    expect(s.speechRate).toBe(1);
    // Nested cue maps still backfilled too.
    expect(s.filterCues.alert.enabled).toBe(true);
    expect(s.buffWarning.enabled).toBe(true);
  });
});

describe('alertsStore — persistence', () => {
  it('round-trips state through localStorage', async () => {
    {
      const { useAlertsStore } = await loadStore();
      useAlertsStore.getState().setMasterVolume(0.4);
      useAlertsStore.getState().setFilterCueEnabled('hunt', true);
      useAlertsStore.getState().setBuffWarningSecs(45);
    }
    vi.resetModules();
    const { useAlertsStore } = await loadStore();
    const s = useAlertsStore.getState();
    expect(s.masterVolume).toBeCloseTo(0.4);
    expect(s.filterCues.hunt.enabled).toBe(true);
    expect(s.buffWarningSecs).toBe(45);
  });
});
