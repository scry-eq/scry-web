// One-shot rename of persisted keys from the pre-Scry `showeq.` prefix.
// Import this FIRST in main.tsx: module bodies evaluate in import order, so
// it runs before any store reads localStorage. Old keys are left in place so
// a rollback still finds them.

const OLD = 'showeq.';
const NEW = 'scry.';

export function migrateLegacyKeys(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(OLD)) continue;
      const next = NEW + key.slice(OLD.length);
      if (localStorage.getItem(next) !== null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(next, value);
    }
  } catch {
    /* private mode / quota — fall through to defaults */
  }
}

migrateLegacyKeys();
