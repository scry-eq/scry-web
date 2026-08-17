import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import {
  FORWARDS_MOUSE,
  createOverlayWindow,
  getOverlayWindow,
  isOverlayLocked,
  overlayStatus,
  setOverlayIgnoreMouse,
  setOverlayLocked,
} from './overlay';
import { OVERLAY_KINDS, isOverlayKind, type OverlayKind } from './kinds';

// Bland, generic window titles so the app blends in on the desktop and nothing in the title
// bar pattern-matches the project name, in case another process enumerates window titles.
const TITLES = [
  'Notes', 'Inbox', 'Calendar', 'Tasks', 'Documents', 'Reader', 'Library', 'Editor',
  'Viewer', 'Console', 'Settings', 'Preferences', 'Workspace', 'Dashboard', 'Untitled',
];
const blandTitle = (): string => TITLES[Math.floor(Math.random() * TITLES.length)];

/**
 * The daemon address, when the UI is not a usable way to set it:
 * `SCRY_DAEMON_URL=ws://host:9090` or `--url ws://host:9090`.
 *
 * The default is localhost, which is wrong for every setup where the client and the daemon
 * are on different machines — and a client pointed at an address that cannot answer is
 * exactly when the address field is hardest to use.
 */
function daemonUrlOverride(): string | null {
  const env = process.env.SCRY_DAEMON_URL;
  if (env) return env;
  const args = process.argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) return args[i + 1];
    const eq = args[i].startsWith('--url=') ? args[i].slice('--url='.length) : '';
    if (eq) return eq;
  }
  return null;
}

/** Dev serves from vite; a packaged build loads the file electron-vite emitted. */
function loadPage(w: BrowserWindow, page: 'index' | 'overlay', kind?: OverlayKind): void {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  // One overlay.html serves every kind; it reads `?kind=` to decide what to draw.
  const query = kind ? `?kind=${kind}` : '';
  if (devServer) void w.loadURL(`${devServer}/${page}.html${query}`);
  else void w.loadFile(join(__dirname, `../renderer/${page}.html`), { search: query.slice(1) });
}

function createMainWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: blandTitle(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  w.once('ready-to-show', () => w.show());

  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  loadPage(w, 'index');
  return w;
}

/** Resolve on `event`, or after `ms` — never leaves the caller waiting on a window. */
function once(w: BrowserWindow, event: 'show', ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      w.removeListener(event, done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    w.once(event, done);
  });
}

function registerIpc(): void {
  ipcMain.handle('daemon:urlOverride', () => daemonUrlOverride());

  // Every overlay call is kind-scoped. An unknown kind falls back to 'vitals' rather than
  // throwing: a bad query string must not be able to take a window down.
  const asKind = (v: unknown): OverlayKind => (isOverlayKind(v) ? v : 'vitals');

  ipcMain.handle('overlay:kinds', () => OVERLAY_KINDS);

  ipcMain.handle('overlay:open', async (_e, k: unknown) => {
    const kind = asKind(k);
    const w = createOverlayWindow(kind, blandTitle());
    if (!w.webContents.getURL()) loadPage(w, 'overlay', kind);
    // The window is `show: false` until 'ready-to-show', so asking now would report NOT
    // visible for a window that is about to appear — and the caller turns that into an
    // error. Wait for the real answer, with a ceiling so a window that never paints
    // reports rather than hangs.
    if (!w.isVisible()) await once(w, 'show', 5000);
    return overlayStatus(kind);
  });
  ipcMain.handle('overlay:close', (_e, k: unknown) => {
    getOverlayWindow(asKind(k))?.close();
  });
  ipcMain.handle('overlay:status', (_e, k: unknown) => overlayStatus(asKind(k)));
  ipcMain.handle('overlay:statusAll', () => OVERLAY_KINDS.map((k) => overlayStatus(k)));
  ipcMain.handle('overlay:locked', (_e, k: unknown) => isOverlayLocked(asKind(k)));
  ipcMain.handle('overlay:forwardsMouse', () => FORWARDS_MOUSE);
  ipcMain.handle('overlay:setLocked', (_e, k: unknown, next: boolean) => {
    setOverlayLocked(asKind(k), Boolean(next));
  });
  // The overlay's own hover handling drives this: `forward: true` means the window still
  // sees mouse-moves while click-through, so the renderer knows when the pointer is over
  // something clickable and asks for capture back.
  ipcMain.handle('overlay:setIgnoreMouse', (_e, k: unknown, ignore: boolean) => {
    const kind = asKind(k);
    if (isOverlayLocked(kind)) setOverlayIgnoreMouse(kind, Boolean(ignore));
  });
}

app.whenReady().then(() => {
  // No application menu. Every accelerator it provided (reload, devtools, zoom) is either
  // unwanted in a game overlay companion or already reachable, and the strip is one more
  // row of chrome on a window whose whole job is to show dense data.
  Menu.setApplicationMenu(null);
  registerIpc();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
