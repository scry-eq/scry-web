import { app, BrowserWindow, ipcMain, shell } from 'electron';
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
function loadPage(w: BrowserWindow, page: 'index' | 'overlay'): void {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) void w.loadURL(`${devServer}/${page}.html`);
  else void w.loadFile(join(__dirname, `../renderer/${page}.html`));
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

function registerIpc(): void {
  ipcMain.handle('daemon:urlOverride', () => daemonUrlOverride());

  ipcMain.handle('overlay:open', () => {
    const w = createOverlayWindow(blandTitle());
    if (!w.webContents.getURL()) loadPage(w, 'overlay');
    return overlayStatus();
  });
  ipcMain.handle('overlay:close', () => {
    getOverlayWindow()?.close();
  });
  ipcMain.handle('overlay:status', () => overlayStatus());
  ipcMain.handle('overlay:locked', () => isOverlayLocked());
  ipcMain.handle('overlay:forwardsMouse', () => FORWARDS_MOUSE);
  ipcMain.handle('overlay:setLocked', (_e, next: boolean) => {
    setOverlayLocked(Boolean(next));
  });
  // The overlay's own hover handling drives this: `forward: true` means the window still
  // sees mouse-moves while click-through, so the renderer knows when the pointer is over
  // something clickable and asks for capture back.
  ipcMain.handle('overlay:setIgnoreMouse', (_e, ignore: boolean) => {
    if (isOverlayLocked()) setOverlayIgnoreMouse(Boolean(ignore));
  });
}

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
