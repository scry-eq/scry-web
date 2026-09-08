// Auto Z and Z-fade, ported from the EQ client's map window: it picks the
// height window per zone and fades geometry out of it instead of clipping.

// Zones the client overrides; everything else gets AUTO_Z_DEFAULT.
const AUTO_Z_WINDOW: Record<string, number> = {
  unrest: 6,
  freporte: 15,
  hateplane: 20,
  sebilis: 20,
  crystal: 20,
  mischiefplane: 20,
  chardok: 30,
  veeshan: 30,
  airplane: 50,
};

export const AUTO_Z_DEFAULT = 10;

// Stacked dungeons where the client quarters the fade floor.
const DARK_FADE_ZONES = new Set(['blackburrow', 'runnyeye', 'gukbottom']);

export function isDarkFadeZone(zoneShort: string): boolean {
  return DARK_FADE_ZONES.has(zoneShort.toLowerCase());
}

export function hasAutoZWindow(zoneShort: string): boolean {
  return AUTO_Z_WINDOW[zoneShort.toLowerCase()] != null;
}

// The client falls back on the zone's type byte, which we never receive — so an
// unlisted zone prefers the map file's own Brewall hint over the blind default.
export function autoZWindow(
  zoneShort: string,
  hintAbove: number,
  hintBelow: number,
): { above: number; below: number } {
  const w = AUTO_Z_WINDOW[zoneShort.toLowerCase()];
  if (w != null) return { above: w, below: w };
  if (hintAbove > 0 || hintBelow > 0) return { above: hintAbove, below: hintBelow };
  return { above: AUTO_Z_DEFAULT, below: AUTO_Z_DEFAULT };
}

export interface ZBandOpts {
  /** Bottom of the fully-opaque band (player Z − below). */
  zMin: number;
  /** Top of the fully-opaque band (player Z + above). */
  zMax: number;
  /** Ramp width under zMin. */
  below: number;
  /** Ramp width over zMax. */
  above: number;
  /** false = hard clip (out of band draws nothing). */
  fade: boolean;
  /** Residual opacity floor, 0..100. */
  fadePercent: number;
  /** Quarter the floor — see isDarkFadeZone. */
  darkZone: boolean;
}

// Returns the 0..1 opacity for an element spanning [zBottom, zTop]; 0 = skip.
// Opaque inside the band, then a linear ramp to the floor over one more band
// width, then flat. The client divides by 5 when the band is narrower.
export function makeZAlpha(o: ZBandOpts): (zBottom: number, zTop: number) => number {
  const raw = Math.min(1, Math.max(0, o.fadePercent / 100));
  const floor = o.darkZone ? raw * 0.25 : raw;
  const stepLow = (1 - raw) / Math.max(o.below, 5);
  const stepHigh = (1 - raw) / Math.max(o.above, 5);
  return (zBottom: number, zTop: number): number => {
    const dLow = o.zMin - zTop;
    const dHigh = zBottom - o.zMax;
    let a: number;
    if (dLow > 0) a = 1 - dLow * stepLow;
    else if (dHigh > 0) a = 1 - dHigh * stepHigh;
    else return 1;
    if (!o.fade) return 0;
    a = Math.max(a, 0);
    return a >= 1 ? 1 : Math.max(a, floor);
  };
}
