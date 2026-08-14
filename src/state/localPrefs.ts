// Per-floating-window position and size, stored under
// `scry.windowPos.{id}` / `scry.windowSize.{id}` keys. Used by
// `FloatingWindow` directly — kept out of the zustand stores because
// the IDs are dynamic (one entry per FloatingWindow id) and the data
// is component-internal. UI behavioral toggles live in `prefsStore`,
// panel layout in `layoutStore`.

export type WindowPos = { x: number; y: number };
export type WindowSize = { w: number; h: number };

function readPos(key: string): WindowPos {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v?.x === 'number' && typeof v?.y === 'number') return v;
    }
  } catch { /* ignore */ }
  return { x: 0, y: 0 };
}

function writePos(key: string, pos: WindowPos): void {
  try {
    localStorage.setItem(key, JSON.stringify(pos));
  } catch { /* ignore */ }
}

// Returns null when no size has been persisted, so the caller can fall
// back to its component-supplied default rather than a zero-sized box.
function readSize(key: string): WindowSize | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v?.w === 'number' && typeof v?.h === 'number') return v;
    }
  } catch { /* ignore */ }
  return null;
}

function writeSize(key: string, size: WindowSize): void {
  try {
    localStorage.setItem(key, JSON.stringify(size));
  } catch { /* ignore */ }
}

export const localPrefs = {
  // Floating-window positions are offsets from the window's CSS-centered
  // initial position (the {0,0} default keeps it centered on first open).
  windowPos: (id: string): WindowPos => readPos(`scry.windowPos.${id}`),
  setWindowPos: (id: string, pos: WindowPos) =>
    writePos(`scry.windowPos.${id}`, pos),
  windowSize: (id: string): WindowSize | null =>
    readSize(`scry.windowSize.${id}`),
  setWindowSize: (id: string, size: WindowSize) =>
    writeSize(`scry.windowSize.${id}`, size),
};
