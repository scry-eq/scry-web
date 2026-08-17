// The overlay windows' bridge: strictly less than the main window's. These float over the
// game and are click-through; they have no business holding the full surface.
//
// One overlay.html serves every kind, so the preload reads `?kind=` here and threads it into
// every call — the renderer never has to, and cannot send a kind that is not its own.
import { contextBridge, ipcRenderer } from 'electron';

const KINDS = ['vitals', 'map'] as const;
type Kind = (typeof KINDS)[number];

function readKind(): Kind {
  try {
    const k = new URLSearchParams(window.location.search).get('kind');
    return (KINDS as readonly string[]).includes(k ?? '') ? (k as Kind) : 'vitals';
  } catch {
    return 'vitals';
  }
}
const KIND = readKind();

contextBridge.exposeInMainWorld('scryOverlay', {
  kind: KIND,
  close: (): Promise<void> => ipcRenderer.invoke('overlay:close', KIND),
  locked: (): Promise<boolean> => ipcRenderer.invoke('overlay:locked', KIND),
  forwardsMouse: (): Promise<boolean> => ipcRenderer.invoke('overlay:forwardsMouse'),
  setLocked: (v: boolean): Promise<void> => ipcRenderer.invoke('overlay:setLocked', KIND, v),
  /** Hand mouse capture back and forth as the pointer crosses the interactive chrome. */
  setIgnoreMouse: (ignore: boolean): Promise<void> =>
    ipcRenderer.invoke('overlay:setIgnoreMouse', KIND, ignore),
  onLockedChanged: (cb: (locked: boolean) => void): (() => void) => {
    const listener = (_e: unknown, v: boolean): void => cb(v);
    ipcRenderer.on('overlay:lockedChanged', listener);
    return () => ipcRenderer.removeListener('overlay:lockedChanged', listener);
  },
});
