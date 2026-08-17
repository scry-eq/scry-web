// The floating game overlays: transparent, frameless, always-on-top windows that sit over
// the client. One per kind, any combination open at once.
//
// Electron gives this natively — transparent + frameless + always-on-top at the screen-saver
// level + setIgnoreMouseEvents(forward) — so there is no cursor sampling and no per-platform
// hit-testing. `forward: true` is why: it keeps the window receiving mouse-MOVES while clicks
// pass through to the game, so the renderer's own hover handling re-enables capture over the
// header and nothing has to guess where the pointer is.

import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';
import { DEFAULT_SIZE, MIN_SIZE, OVERLAY_KINDS, type OverlayKind } from './kinds';
import { flushOverlayBounds, readOverlayBounds, saveOverlayBounds, type Bounds } from './store';
import { newDragSession, snapDrag, type SnapTargets } from './snap';

/**
 * Can a click-through window still receive mouse-MOVES? `setIgnoreMouseEvents`'s `forward`
 * option is Windows/macOS only. Where it is false the renderer never learns the pointer is
 * over it, so the hover-to-recover mechanism cannot work — and a locked overlay with hidden
 * chrome, no taskbar button and no Alt-Tab entry would be unrecoverable.
 */
export const FORWARDS_MOUSE = process.platform === 'win32' || process.platform === 'darwin';

const windows = new Map<OverlayKind, BrowserWindow>();
/** Locked = click-through over the game. Unlocked = an ordinary window you can place. */
const lockState = new Map<OverlayKind, boolean>();

export function getOverlayWindow(kind: OverlayKind): BrowserWindow | null {
  const w = windows.get(kind);
  if (!w || w.isDestroyed()) return null;
  return w;
}

/** Every live overlay, for callers that need the whole population (snapping, teardown). */
export function openOverlays(): { kind: OverlayKind; win: BrowserWindow }[] {
  return OVERLAY_KINDS.flatMap((kind) => {
    const win = getOverlayWindow(kind);
    return win ? [{ kind, win }] : [];
  });
}

export function isOverlayLocked(kind: OverlayKind): boolean {
  return lockState.get(kind) ?? false;
}

/**
 * Click-through, or not. ONE definition — the lock toggle and the renderer's finer-grained
 * hover both land here, because two call sites disagreeing about `forward` is a performance
 * bug nobody can see.
 */
export function setOverlayIgnoreMouse(kind: OverlayKind, ignore: boolean): void {
  const w = getOverlayWindow(kind);
  if (!w) return;
  if (ignore) w.setIgnoreMouseEvents(true, { forward: FORWARDS_MOUSE });
  else w.setIgnoreMouseEvents(false);
}

export function setOverlayLocked(kind: OverlayKind, next: boolean): void {
  lockState.set(kind, next);
  const w = getOverlayWindow(kind);
  if (!w) return;
  // setFocusable moves the FOREGROUND window on Windows, so it is only touched when the
  // value actually changes — an overlay that re-asserts it on every update hands focus back
  // to whatever is underneath, which is the game.
  if (w.isFocusable() === next) w.setFocusable(!next);
  setOverlayIgnoreMouse(kind, next);
  w.webContents.send('overlay:lockedChanged', next);
}

/** Where a window is, as the OS reports it — reported into the UI, never inferred. */
export function overlayStatus(kind: OverlayKind): Record<string, unknown> {
  const w = getOverlayWindow(kind);
  const displays = screen.getAllDisplays().map((d) => {
    const b = d.bounds;
    return `${b.width}x${b.height}+${b.x}+${b.y}@${d.scaleFactor}`;
  });
  if (!w) return { kind, exists: false, visible: false, displays };
  const b = w.getBounds();
  return {
    kind,
    exists: true,
    visible: w.isVisible(),
    x: b.x,
    y: b.y,
    w: b.width,
    h: b.height,
    scale: screen.getDisplayMatching(b).scaleFactor,
    locked: isOverlayLocked(kind),
    displays,
  };
}

function centered(kind: OverlayKind): Bounds {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const size = DEFAULT_SIZE[kind];
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + (area.height - size.height) / 2),
    ...size,
  };
}

/**
 * A saved rectangle is only usable if it still lands on a display that EXISTS NOW. Monitors
 * get unplugged, resolutions change, and a laptop that docked at three screens opens at one
 * — restoring blindly then puts the overlay somewhere the user cannot see or reach, and it
 * has no taskbar button or Alt-Tab entry to recover it with.
 *
 * "Usable" means a meaningful corner is visible, not a single pixel: enough of the header to
 * grab, on some display's work area.
 */
function onScreen(kind: OverlayKind, b: Bounds | null): Bounds | null {
  if (!b) return null;
  const NEEDED = { w: 120, h: 28 };
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const overlapW = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const overlapH = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return overlapW >= NEEDED.w && overlapH >= NEEDED.h;
  });
  if (!visible) return null;
  // Never restore below the floor the window can render at.
  return {
    ...b,
    width: Math.max(b.width, MIN_SIZE[kind].width),
    height: Math.max(b.height, MIN_SIZE[kind].height),
  };
}

/**
 * What a drag can line up against: every other window this app owns that is actually on
 * screen, and the work area of each display — so a snapped window lands beside the taskbar
 * rather than under it.
 */
function snapTargets(self: BrowserWindow): SnapTargets {
  return {
    windows: BrowserWindow.getAllWindows()
      .filter((w) => w !== self && !w.isDestroyed() && w.isVisible())
      .map((w) => w.getBounds()),
    screens: screen.getAllDisplays().map((d) => d.workArea),
  };
}

/**
 * Magnetize this window's drags.
 *
 * `will-move` is the only seam there is: the header is an OS drag region, so the renderer
 * never sees a mousemove and has nothing to correct. This is the one event that fires with
 * the rectangle the OS is about to apply, and that `preventDefault()` can veto — so the
 * mechanism is "refuse the move the OS wanted, apply the one we want".
 *
 * Windows/macOS only; on Linux the event never fires and a drag behaves exactly as it always
 * has. And `setBounds` can itself provoke `will-move`, so a listener that answered its own
 * write would be a feedback loop inside the drag — hence the guard.
 */
function installSnap(w: BrowserWindow): void {
  const session = newDragSession();
  let applying = false;
  w.on('will-move', (event, proposed) => {
    if (applying) return;
    const snapped = snapDrag(session, proposed, snapTargets(w), Date.now());
    if (snapped.x === proposed.x && snapped.y === proposed.y) return;
    event.preventDefault();
    applying = true;
    try {
      w.setBounds(snapped);
    } finally {
      applying = false;
    }
  });
}

export function createOverlayWindow(kind: OverlayKind, title: string): BrowserWindow {
  const existing = getOverlayWindow(kind);
  if (existing) {
    existing.show();
    return existing;
  }

  // Where the user last left it, if that is still somewhere they can see. Otherwise
  // centered on the display the cursor is on, rather than whatever corner the OS picks.
  const { x, y, width, height } = onScreen(kind, readOverlayBounds(kind)) ?? centered(kind);

  // UNLOCKED to start. Locked means click-through with the chrome hidden — a panel with no
  // visible controls that is also absent from the taskbar and Alt-Tab, i.e. one the user
  // cannot find. It gets locked once they can see where they put it.
  lockState.set(kind, false);

  const w = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: MIN_SIZE[kind].width,
    minHeight: MIN_SIZE[kind].height,
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
  windows.set(kind, w);

  // Above ordinary windows and above a borderless game.
  w.setAlwaysOnTop(true, 'screen-saver');

  w.once('ready-to-show', () => {
    // showInactive so opening an overlay never pulls focus off the game.
    w.showInactive();
    w.setAlwaysOnTop(true, 'screen-saver');
    setOverlayLocked(kind, isOverlayLocked(kind));
  });

  installSnap(w);

  // Persist the user's own placement. 'moved'/'resized' only fire for a real move, so
  // nothing here records a position the app chose for itself.
  const remember = (): void => {
    if (!w.isDestroyed()) saveOverlayBounds(kind, w.getBounds());
  };
  w.on('moved', remember);
  w.on('resized', remember);
  // 'close' still has a live window; 'closed' does not, and a drag that ends by closing the
  // window would otherwise be lost inside the debounce.
  w.on('close', () => {
    if (!w.isDestroyed()) flushOverlayBounds(kind, w.getBounds());
  });

  w.on('closed', () => {
    windows.delete(kind);
  });

  // An overlay renders our page and nothing else; any link opens in the real browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return w;
}
