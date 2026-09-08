import { describe, expect, it } from 'vitest';
import {
  AUTO_Z_DEFAULT,
  autoZWindow,
  hasAutoZWindow,
  isDarkFadeZone,
  makeZAlpha,
  type ZBandOpts,
} from './mapZ';

describe('autoZWindow', () => {
  it('uses the client table for listed zones, above and below alike', () => {
    expect(autoZWindow('unrest', 0, 0)).toEqual({ above: 6, below: 6 });
    expect(autoZWindow('freporte', 0, 0)).toEqual({ above: 15, below: 15 });
    expect(autoZWindow('airplane', 0, 0)).toEqual({ above: 50, below: 50 });
    expect(autoZWindow('chardok', 0, 0)).toEqual({ above: 30, below: 30 });
  });

  it('prefers the table over a map hint', () => {
    expect(autoZWindow('sebilis', 75, 75)).toEqual({ above: 20, below: 20 });
  });

  it('falls back to the map hint for unlisted zones', () => {
    expect(autoZWindow('gukbottom', 40, 12)).toEqual({ above: 40, below: 12 });
  });

  it('falls back to the default with no table entry and no hint', () => {
    expect(autoZWindow('qeynos2', 0, 0)).toEqual({
      above: AUTO_Z_DEFAULT,
      below: AUTO_Z_DEFAULT,
    });
  });

  it('matches zone names case-insensitively', () => {
    expect(autoZWindow('Unrest', 0, 0)).toEqual({ above: 6, below: 6 });
    expect(hasAutoZWindow('AirPlane')).toBe(true);
    expect(hasAutoZWindow('qeynos')).toBe(false);
  });
});

describe('isDarkFadeZone', () => {
  it('covers exactly the three zones the client quarters', () => {
    expect(isDarkFadeZone('blackburrow')).toBe(true);
    expect(isDarkFadeZone('runnyeye')).toBe(true);
    expect(isDarkFadeZone('gukbottom')).toBe(true);
    expect(isDarkFadeZone('guktop')).toBe(false);
    expect(isDarkFadeZone('unrest')).toBe(false);
  });
});

// Player at Z 0 with a ±10 band and a 20% floor: the ramp step is
// (1 - 0.2) / 10 = 0.08 per unit outside the band.
const band = (over: Partial<ZBandOpts> = {}): ZBandOpts => ({
  zMin: -10,
  zMax: 10,
  below: 10,
  above: 10,
  fade: true,
  fadePercent: 20,
  darkZone: false,
  ...over,
});

describe('makeZAlpha — clipping (fade off)', () => {
  const a = makeZAlpha(band({ fade: false }));

  it('is opaque inside the band, inclusive of the edges', () => {
    expect(a(0, 0)).toBe(1);
    expect(a(-10, -10)).toBe(1);
    expect(a(10, 10)).toBe(1);
  });

  it('drops anything wholly outside the band', () => {
    expect(a(-11, -11)).toBe(0);
    expect(a(11, 11)).toBe(0);
  });

  it('keeps a span that straddles an edge', () => {
    expect(a(-40, -5)).toBe(1);
    expect(a(5, 40)).toBe(1);
  });
});

describe('makeZAlpha — fading', () => {
  const a = makeZAlpha(band());

  it('is opaque inside the band', () => {
    expect(a(0, 0)).toBe(1);
    expect(a(-10, 10)).toBe(1);
  });

  it('ramps linearly away from the band edge', () => {
    expect(a(-15, -15)).toBeCloseTo(0.6, 6);
    expect(a(15, 15)).toBeCloseTo(0.6, 6);
    expect(a(-12.5, -12.5)).toBeCloseTo(0.8, 6);
  });

  it('reaches the floor exactly one band width out, and holds it', () => {
    expect(a(-20, -20)).toBeCloseTo(0.2, 6);
    expect(a(-1000, -1000)).toBeCloseTo(0.2, 6);
    expect(a(1000, 1000)).toBeCloseTo(0.2, 6);
  });

  it('never hides anything while the floor is above zero', () => {
    expect(a(1e6, 1e6)).toBeGreaterThan(0);
  });

  it('measures from the near edge of a span', () => {
    // Top at -15 is 5 below zMin; the far end of the span does not matter.
    expect(a(-90, -15)).toBeCloseTo(0.6, 6);
  });

  it('quarters the floor in the dark zones', () => {
    const dark = makeZAlpha(band({ darkZone: true }));
    expect(dark(-1000, -1000)).toBeCloseTo(0.05, 6);
    // The ramp slope is unchanged — only the clamp moves.
    expect(dark(-15, -15)).toBeCloseTo(0.6, 6);
  });

  it('fades to nothing at 0%', () => {
    const hard = makeZAlpha(band({ fadePercent: 0 }));
    expect(hard(-15, -15)).toBeCloseTo(0.5, 6);
    expect(hard(-20, -20)).toBe(0);
    expect(hard(-1000, -1000)).toBe(0);
  });

  it('uses a floor of 5 for the ramp width so a zero band still ramps', () => {
    const narrow = makeZAlpha(band({ zMin: 0, zMax: 0, above: 0, below: 0 }));
    // step = (1 - 0.2) / 5 = 0.16
    expect(narrow(-1, -1)).toBeCloseTo(0.84, 6);
    expect(narrow(-5, -5)).toBeCloseTo(0.2, 6);
  });
});

describe('makeZAlpha — filter off', () => {
  it('is opaque everywhere on an infinite band', () => {
    const a = makeZAlpha(band({ zMin: -Infinity, zMax: Infinity }));
    expect(a(-1e9, -1e9)).toBe(1);
    expect(a(1e9, 1e9)).toBe(1);
  });
});
