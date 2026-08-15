// The desktop surface the overlay uses, and the no-op it degrades to in a plain browser —
// `bun run dev` opens overlay.html as an ordinary page, and it must still render.

export type Status = {
  exists: boolean;
  visible: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  scale?: number;
  locked?: boolean;
  displays: string[];
};

type MainApi = {
  daemonUrlOverride: () => Promise<string | null>;
  overlay: {
    open: () => Promise<Status>;
    close: () => Promise<void>;
    status: () => Promise<Status>;
    locked: () => Promise<boolean>;
    setLocked: (v: boolean) => Promise<void>;
  };
};

type OverlayApi = {
  close: () => Promise<void>;
  locked: () => Promise<boolean>;
  forwardsMouse: () => Promise<boolean>;
  setLocked: (v: boolean) => Promise<void>;
  setIgnoreMouse: (ignore: boolean) => Promise<void>;
  onLockedChanged: (cb: (locked: boolean) => void) => () => void;
};

declare global {
  interface Window {
    scry?: MainApi;
    scryOverlay?: OverlayApi;
  }
}

/** Running inside the desktop shell (either window). */
export const isDesktop = typeof window !== 'undefined' && !!(window.scry ?? window.scryOverlay);

/** The main window's API, or null in a browser. */
export const main = (): MainApi | null => (typeof window === 'undefined' ? null : window.scry ?? null);

/** The overlay window's API, or null in a browser. */
export const overlay = (): OverlayApi | null =>
  typeof window === 'undefined' ? null : window.scryOverlay ?? null;
