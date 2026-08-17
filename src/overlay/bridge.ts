// The desktop surface the overlay uses, and the no-op it degrades to in a plain browser —
// `bun run dev` opens overlay.html as an ordinary page, and it must still render.

export const OVERLAY_KINDS = ['vitals', 'map'] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export const KIND_LABEL: Record<OverlayKind, string> = {
  vitals: 'Vitals',
  map: 'Map',
};

export type Status = {
  kind: OverlayKind;
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
    kinds: () => Promise<OverlayKind[]>;
    open: (kind: OverlayKind) => Promise<Status>;
    close: (kind: OverlayKind) => Promise<void>;
    status: (kind: OverlayKind) => Promise<Status>;
    statusAll: () => Promise<Status[]>;
  };
};

type OverlayApi = {
  /** Which panel this window is, read from `?kind=` by the preload. */
  kind: OverlayKind;
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
