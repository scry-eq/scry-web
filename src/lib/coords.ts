// Coordinate-convention helpers shared by every UI surface that prints
// a position number.
//
// The daemon ships positions in SCREEN convention (+X = East/right,
// +Y = South/down) — X and Y are negated from EQ's RUNTIME convention
// (+X = West, +Y = North) at proto-serialization time (see
// scry-cpp/src/protoencoder.cpp fillPos). The map renders directly
// in screen convention, so dot/line/grid geometry is correct as-is.
//
// EQ's in-game `/loc` command, however, prints (Y, X, Z) in runtime
// convention. Any coordinate the user reads and compares to `/loc` must
// be flipped back — otherwise the number looks negated/backwards even
// though the point on the map is right. Route ALL user-facing coordinate
// text through these helpers so the tooltip, the status bar, and the map
// grid labels all agree with in-game `/loc`.

/** Runtime (in-game /loc) X for a screen-convention wire X. */
export const runtimeX = (screenX: number): number => -screenX;

/** Runtime (in-game /loc) Y for a screen-convention wire Y. */
export const runtimeY = (screenY: number): number => -screenY;

/**
 * Format a screen-convention position as the in-game `/loc` string
 * "Y, X, Z" (runtime convention), rounded to whole units.
 */
export function formatLoc(x: number, y: number, z: number): string {
  return `${Math.round(runtimeY(y))}, ${Math.round(runtimeX(x))}, ${Math.round(z)}`;
}
