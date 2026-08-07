import { describe, it, expect } from 'vitest';
import { conOf } from './concolor';

describe('conOf', () => {
  it('returns white when either level is unknown', () => {
    expect(conOf(0, 10)).toBe('white');
    expect(conOf(10, 0)).toBe('white');
  });

  // The client's con table yellows +1..+5 and reds at +6.
  it('uses fixed bands at/above the player level', () => {
    expect(conOf(20, 20)).toBe('white');  // even
    expect(conOf(20, 21)).toBe('yellow'); // +1
    expect(conOf(20, 23)).toBe('yellow'); // +3
    expect(conOf(20, 25)).toBe('yellow'); // +5
    expect(conOf(20, 26)).toBe('red');    // +6
    expect(conOf(20, 30)).toBe('red');
  });

  // Verified in-game against a guild-hall dummy: at low levels the lower
  // bands compress so grey reaches up to delta -6 and everything between it
  // and the player is dark blue (no light-blue/green room).
  it('compresses to grey/blue at level 7 (live-verified)', () => {
    expect(conOf(7, 1)).toBe('gray');
    expect(conOf(7, 2)).toBe('blue');
    expect(conOf(7, 6)).toBe('blue');
    expect(conOf(7, 7)).toBe('white');
  });

  it('compresses to grey/blue at level 8 (live-verified)', () => {
    expect(conOf(8, 1)).toBe('gray');
    expect(conOf(8, 2)).toBe('gray');
    expect(conOf(8, 3)).toBe('blue');
    expect(conOf(8, 7)).toBe('blue');
    expect(conOf(8, 8)).toBe('white');
  });

  // Live-verified at level 18: grey reaches up to level-7 (11) and green is
  // the single level just above it (12). The legacy table greyed only to
  // level-8 here, mis-coloring 11 as green.
  it('greys up to level-7 at level 18 (live-verified)', () => {
    expect(conOf(18, 10)).toBe('gray');
    expect(conOf(18, 11)).toBe('gray');
    expect(conOf(18, 12)).toBe('green');
    expect(conOf(18, 13)).toBe('blue');
  });

  // Live-verified at level 21: grey reaches up to level-8 (13), green 14.
  it('greys up to level-8 at level 21 (live-verified)', () => {
    expect(conOf(21, 12)).toBe('gray');
    expect(conOf(21, 13)).toBe('gray');
    expect(conOf(21, 14)).toBe('green');
    expect(conOf(21, 15)).toBe('cyan'); // delta -6, light blue
    expect(conOf(21, 16)).toBe('blue'); // delta -5, dark blue
  });

  // Levels where the old hand-tuned ladder disagreed with the client table
  // by one at the grey/green edge. L15 has no room for green at all (both
  // bases land on 10), and L28 greens from 18 rather than 19.
  it('matches the client table at the grey/green edge', () => {
    expect(conOf(15, 9)).toBe('gray');
    expect(conOf(15, 10)).toBe('blue');
    expect(conOf(28, 17)).toBe('gray');
    expect(conOf(28, 18)).toBe('green');
    expect(conOf(28, 20)).toBe('green');
    expect(conOf(28, 21)).toBe('cyan');
  });

  // By level 57+ the table reaches the uncompressed flat formula:
  //   <= -21 grey, -16..-20 green, -6..-15 light blue, -1..-5 dark blue.
  it('shows the full uncompressed bands at level 60', () => {
    expect(conOf(60, 39)).toBe('gray');  // -21
    expect(conOf(60, 40)).toBe('green'); // -20
    expect(conOf(60, 44)).toBe('green'); // -16
    expect(conOf(60, 45)).toBe('cyan');  // -15 (light blue)
    expect(conOf(60, 54)).toBe('cyan');  // -6
    expect(conOf(60, 55)).toBe('blue');  // -5 (dark blue)
    expect(conOf(60, 59)).toBe('blue');  // -1
    expect(conOf(60, 60)).toBe('white');
  });
});
