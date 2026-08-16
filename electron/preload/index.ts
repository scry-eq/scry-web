// The main window's bridge. Self-contained on purpose — a preload that imports a shared
// module gets rolled into a chunk, and a SANDBOXED preload cannot `require` one.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('scry', {
  daemonUrlOverride: (): Promise<string | null> => ipcRenderer.invoke('daemon:urlOverride'),
  overlay: {
    kinds: (): Promise<string[]> => ipcRenderer.invoke('overlay:kinds'),
    open: (kind: string): Promise<unknown> => ipcRenderer.invoke('overlay:open', kind),
    close: (kind: string): Promise<void> => ipcRenderer.invoke('overlay:close', kind),
    status: (kind: string): Promise<unknown> => ipcRenderer.invoke('overlay:status', kind),
    statusAll: (): Promise<unknown[]> => ipcRenderer.invoke('overlay:statusAll'),
  },
});
