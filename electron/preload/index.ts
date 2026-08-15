// The main window's bridge. Self-contained on purpose — a preload that imports a shared
// module gets rolled into a chunk, and a SANDBOXED preload cannot `require` one.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('scry', {
  daemonUrlOverride: (): Promise<string | null> => ipcRenderer.invoke('daemon:urlOverride'),
  overlay: {
    open: (): Promise<unknown> => ipcRenderer.invoke('overlay:open'),
    close: (): Promise<void> => ipcRenderer.invoke('overlay:close'),
    status: (): Promise<unknown> => ipcRenderer.invoke('overlay:status'),
    locked: (): Promise<boolean> => ipcRenderer.invoke('overlay:locked'),
    setLocked: (v: boolean): Promise<void> => ipcRenderer.invoke('overlay:setLocked', v),
  },
});
