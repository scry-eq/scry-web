// The overlay window's bridge: strictly less than the main window's. This window floats over
// the game and is click-through; it has no business holding the full surface.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('scryOverlay', {
  close: (): Promise<void> => ipcRenderer.invoke('overlay:close'),
  locked: (): Promise<boolean> => ipcRenderer.invoke('overlay:locked'),
  forwardsMouse: (): Promise<boolean> => ipcRenderer.invoke('overlay:forwardsMouse'),
  setLocked: (v: boolean): Promise<void> => ipcRenderer.invoke('overlay:setLocked', v),
  /** Hand mouse capture back and forth as the pointer crosses the interactive chrome. */
  setIgnoreMouse: (ignore: boolean): Promise<void> =>
    ipcRenderer.invoke('overlay:setIgnoreMouse', ignore),
  onLockedChanged: (cb: (locked: boolean) => void): (() => void) => {
    const listener = (_e: unknown, v: boolean): void => cb(v);
    ipcRenderer.on('overlay:lockedChanged', listener);
    return () => ipcRenderer.removeListener('overlay:lockedChanged', listener);
  },
});
