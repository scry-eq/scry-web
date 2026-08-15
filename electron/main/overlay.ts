// The floating game overlay: one transparent, frameless, always-on-top window that sits over
// the client. Electron gives this natively — transparent + frameless + always-on-top at the
// screen-saver level + setIgnoreMouseEvents(forward) — so there is no cursor sampling and no
// per-platform hit-testing here.
//
// `forward: true` is the whole reason this file is short. It keeps the window receiving
// mouse-MOVES while clicks pass through to the game, so the renderer's own hover handling is
// what re-enables capture over the header. Nothing has to guess where the pointer is.

import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';

export const OVERLAY_LABEL = 'overlay';

/**
 * Can a click-through window still receive mouse-MOVES? `setIgnoreMouseEvents`'s `forward`
 * option is Windows/macOS only. Where it is false the renderer never learns the pointer is
 * over it, so the hover-to-recover mechanism cannot work — and a locked overlay with hidden
 * chrome, no taskbar button and no Alt-Tab entry would be unrecoverable.
 */
export const FORWARDS_MOUSE = process.platform === 'win32' || process.platform === 'darwin';

const DEFAULT_SIZE = { width: 340, height: 200 };
const MIN_SIZE = { width: 180, height: 90 };

let overlayWindow: BrowserWindow | null = null;
/** Locked = click-through over the game. Unlocked = an ordinary window you can place. */
let locked = false;

export function getOverlayWindow(): BrowserWindow | null {
  if (overlayWindow?.isDestroyed()) return null;
  return overlayWindow;
}

export function isOverlayLocked(): boolean {
  return locked;
}

/**
 * Click-through, or not. ONE definition — the lock toggle and the renderer's finer-grained
 * hover both land here, because two call sites disagreeing about `forward` is a performance
 * bug nobody can see.
 */
export function setOverlayIgnoreMouse(ignore: boolean): void {
  const w = getOverlayWindow();
  if (!w) return;
  if (ignore) w.setIgnoreMouseEvents(true, { forward: FORWARDS_MOUSE });
  else w.setIgnoreMouseEvents(false);
}

export function setOverlayLocked(next: boolean): void {
  locked = next;
  const w = getOverlayWindow();
  if (!w) return;
  // setFocusable moves the FOREGROUND window on Windows, so it is only touched when the
  // value actually changes — an overlay that re-asserts it on every update hands focus back
  // to whatever is underneath, which is the game.
  if (w.isFocusable() === next) w.setFocusable(!next);
  setOverlayIgnoreMouse(next);
  w.webContents.send('overlay:lockedChanged', next);
}

/** Where the window is, as the OS reports it — reported into the UI, never inferred. */
export function overlayStatus(): Record<string, unknown> {
  const w = getOverlayWindow();
  const displays = screen.getAllDisplays().map((d) => {
    const b = d.bounds;
    return `${b.width}x${b.height}+${b.x}+${b.y}@${d.scaleFactor}`;
  });
  if (!w) return { exists: false, visible: false, displays };
  const b = w.getBounds();
  return {
    exists: true,
    visible: w.isVisible(),
    x: b.x,
    y: b.y,
    w: b.width,
    h: b.height,
    scale: screen.getDisplayMatching(b).scaleFactor,
    locked,
    displays,
  };
}

export function createOverlayWindow(title: string): BrowserWindow {
  const existing = getOverlayWindow();
  if (existing) {
    existing.show();
    return existing;
  }

  // Centered on the display the cursor is on, so it opens where the user is looking rather
  // than at whatever corner the OS would pick.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const x = Math.round(area.x + (area.width - DEFAULT_SIZE.width) / 2);
  const y = Math.round(area.y + (area.height - DEFAULT_SIZE.height) / 2);

  // UNLOCKED to start. Locked means click-through with the chrome hidden — a panel with no
  // visible controls that is also absent from the taskbar and Alt-Tab, i.e. one the user
  // cannot find. It gets locked once they can see where they put it.
  locked = false;

  const w = new BrowserWindow({
    x,
    y,
    ...DEFAULT_SIZE,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    // Out of Alt-Tab as well, which skipTaskbar alone does not do on Windows — 'toolbar'
    // sets WS_EX_TOOLWINDOW, the style Alt-Tab actually consults. NOT `parent`, which would
    // also leave Alt-Tab but would minimize the overlay along with the main window.
    type: 'toolbar',
    hasShadow: false,
    // A transparent window has no native background; the page's own rgba does the work.
    backgroundColor: '#00000000',
    title,
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  overlayWindow = w;

  // Above ordinary windows and above a borderless game.
  w.setAlwaysOnTop(true, 'screen-saver');

  w.once('ready-to-show', () => {
    // showInactive so opening the overlay never pulls focus off the game.
    w.showInactive();
    w.setAlwaysOnTop(true, 'screen-saver');
    setOverlayLocked(locked);
  });

  w.on('closed', () => {
    overlayWindow = null;
  });

  // The overlay renders our page and nothing else; any link opens in the real browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return w;
}
