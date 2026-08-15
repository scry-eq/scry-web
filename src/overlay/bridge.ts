// The Tauri surface the overlay uses, and the no-op it degrades to in a plain browser —
// `bun run dev` opens overlay.html as an ordinary page, and it must still render.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type Rect = { x: number; y: number; w: number; h: number };
/** What the overlay window actually is right now, as the OS reports it. */
export type Status = {
  exists: boolean;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  locked: boolean;
  opaque: boolean;
  monitors: string[];
};
export type Hover = { inside: boolean; x: number; y: number };

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const overlay = {
  open: () => (inTauri ? invoke<void>('overlay_open') : Promise.resolve()),
  close: () => (inTauri ? invoke<void>('overlay_close') : Promise.resolve()),
  locked: () => (inTauri ? invoke<boolean>('overlay_locked') : Promise.resolve(false)),
  status: () => (inTauri ? invoke<Status>('overlay_status') : Promise.resolve(null)),
  setLocked: (locked: boolean) =>
    inTauri ? invoke<void>('overlay_set_locked', { locked }) : Promise.resolve(),
  // Regions that stay clickable while locked. Measured by the DOM rather than assumed by
  // Rust, so restyling the chrome can never leave the clickable area behind.
  setHotZones: (zones: Rect[]) =>
    inTauri ? invoke<void>('overlay_set_hot_zones', { zones }) : Promise.resolve(),
};

export function onHover(fn: (h: Hover) => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<Hover>('overlay://hover', (e) => fn(e.payload));
}

export function onLocked(fn: (locked: boolean) => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<boolean>('overlay://locked', (e) => fn(e.payload));
}
