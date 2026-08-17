// The overlay kinds, and the one place their identity lives. Shared by main and the
// renderer via a plain string union so adding a kind is a list entry, not a refactor.

export const OVERLAY_KINDS = ['vitals', 'map'] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export function isOverlayKind(v: unknown): v is OverlayKind {
  return typeof v === 'string' && (OVERLAY_KINDS as readonly string[]).includes(v);
}

/** Opening size, before any remembered bounds. A map needs room; a vitals strip does not. */
export const DEFAULT_SIZE: Record<OverlayKind, { width: number; height: number }> = {
  vitals: { width: 340, height: 200 },
  map: { width: 520, height: 440 },
};

export const MIN_SIZE: Record<OverlayKind, { width: number; height: number }> = {
  vitals: { width: 180, height: 90 },
  map: { width: 240, height: 200 },
};
