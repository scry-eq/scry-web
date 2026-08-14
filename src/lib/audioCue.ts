import { useAlertsStore, type FilterCueKey } from '@/state/alertsStore';

// Tiny audio playback layer. Owns a single HTMLAudioElement per cue so
// repeat plays don't trigger a new fetch and don't pile up overlapping
// instances. Each `play()` rewinds the element and starts again with
// the latest volume — fine for short cues (<500ms), since we never want
// two simultaneous copies of the same alert anyway.
//
// Per-cue cooldown: a busy zone can flood with spawnAdded events on a
// big pull, and we'd otherwise spam the speaker. A 600 ms minimum gap
// between consecutive plays of the same cue absorbs the wave without
// hiding distinct triggers — single-event cues still feel responsive.

const COOLDOWN_MS = 600;

// Vite serves /public at the site root; in CI builds the base path is
// `/scry-web/` (vite.config.ts), so use a leading slash + relative
// path so import.meta.env.BASE_URL prepends correctly.
function urlFor(name: string): string {
  return `${import.meta.env.BASE_URL}sounds/${name}.wav`;
}

type CueRecord = { audio: HTMLAudioElement; lastPlayedMs: number };

const cache = new Map<string, CueRecord>();

function getOrCreate(name: string): CueRecord {
  const existing = cache.get(name);
  if (existing) return existing;
  const audio = new Audio(urlFor(name));
  audio.preload = 'auto';
  const rec: CueRecord = { audio, lastPlayedMs: 0 };
  cache.set(name, rec);
  return rec;
}

// Computes the effective gain for a cue at play time. Returning a
// non-positive number signals "don't play" so callers can short-circuit
// before touching the audio element.
function effectiveVolume(cueVolume: number, cueEnabled: boolean): number {
  const s = useAlertsStore.getState();
  if (!cueEnabled || s.muted) return 0;
  return Math.max(0, Math.min(1, cueVolume * s.masterVolume));
}

export function playFilterCue(key: FilterCueKey): void {
  const s = useAlertsStore.getState();
  const cue = s.filterCues[key];
  if (!cue) return;
  const v = effectiveVolume(cue.volume, cue.enabled);
  if (v <= 0) return;
  playWithCooldown(key, v);
}

export function playBuffFading(): void {
  const s = useAlertsStore.getState();
  const v = effectiveVolume(s.buffWarning.volume, s.buffWarning.enabled);
  if (v <= 0) return;
  playWithCooldown('buff-fading', v);
}

// Play any cue by file basename, ignoring enable/mute state. Used by
// the settings panel's "test" button so the user can preview a cue
// even when it's currently disabled. Master volume + master mute still
// apply — there's no path that should override "muted" globally.
export function previewCue(name: string, cueVolume: number): void {
  const s = useAlertsStore.getState();
  if (s.muted) return;
  const v = Math.max(0, Math.min(1, cueVolume * s.masterVolume));
  if (v <= 0) return;
  playWithCooldown(name, v);
}

function playWithCooldown(name: string, volume: number): void {
  const rec = getOrCreate(name);
  const now = performance.now();
  if (now - rec.lastPlayedMs < COOLDOWN_MS) return;
  rec.lastPlayedMs = now;
  rec.audio.volume = volume;
  // Rewinding handles the case where the element is already playing —
  // overlapping copies of a beep just sound muddy.
  rec.audio.currentTime = 0;
  // play() returns a Promise that rejects if the user hasn't interacted
  // with the page yet (autoplay policy). Swallow the rejection — the
  // first user click anywhere unblocks subsequent plays, and a dropped
  // first cue is cheaper than a console error per session.
  rec.audio.play().catch(() => { /* autoplay-blocked or device busy */ });
}
