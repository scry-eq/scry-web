// Preferences are per-WINDOW state backed by one shared localStorage entry, so a change in
// the main window never reaches an overlay's in-memory copy — the overlay keeps whatever was
// stored the moment it opened. That is why "follow player" and the select-on-target toggles
// appeared to be ignored there.
//
// The `storage` event is the right mechanism and fires for other same-origin documents, but
// this app is also loaded from `file://` in a packaged build, where that guarantee is worth
// less. So the event is the fast path and a cheap poll is the one that always works: reading
// one localStorage string a second costs nothing next to being silently out of sync.
import { usePrefsStore } from './prefsStore';
import { useSpawnFilterStore } from './spawnFilterStore';

const WATCHED: { key: string; rehydrate: () => Promise<void> | void }[] = [
  { key: 'scry.prefs', rehydrate: () => usePrefsStore.persist.rehydrate() },
  { key: 'scry.spawnFilters', rehydrate: () => useSpawnFilterStore.persist.rehydrate() },
];

const POLL_MS = 1000;

export function installPrefsSync(): () => void {
  const last = new Map<string, string | null>();
  for (const { key } of WATCHED) last.set(key, safeRead(key));

  const check = (): void => {
    for (const { key, rehydrate } of WATCHED) {
      const now = safeRead(key);
      if (now === last.get(key)) continue;
      last.set(key, now);
      void rehydrate();
    }
  };

  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || WATCHED.some((w) => w.key === e.key)) check();
  };

  window.addEventListener('storage', onStorage);
  const id = setInterval(check, POLL_MS);
  return () => {
    window.removeEventListener('storage', onStorage);
    clearInterval(id);
  };
}

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
