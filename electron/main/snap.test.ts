import { describe, expect, it } from 'vitest';
import {
  DRAG_RESUME_MS,
  SNAP_DISTANCE_PX,
  newDragSession,
  snapDrag,
  snapMovingBounds,
  type SnapTargets,
} from './snap';

const screen: SnapTargets = { windows: [], screens: [{ x: 0, y: 0, width: 1920, height: 1040 }] };
const r = (x: number, y: number, width = 340, height = 200) => ({ x, y, width, height });

describe('snapMovingBounds', () => {
  it('pulls to a screen work-area edge from within the snap distance', () => {
    expect(snapMovingBounds(r(5, 300), screen).x).toBe(0);
    expect(snapMovingBounds(r(1920 - 340 - 6, 300), screen).x).toBe(1920 - 340);
  });

  it('leaves a window alone when nothing is near', () => {
    const moving = r(500, 400);
    expect(snapMovingBounds(moving, screen)).toEqual(moving);
  });

  it('abuts one window against another', () => {
    const targets: SnapTargets = { windows: [r(600, 400)], screens: [] };
    // Right edge of the mover onto the left edge of the target.
    expect(snapMovingBounds(r(600 - 340 + 5, 400), targets).x).toBe(600 - 340);
  });

  it('aligns edges of a stacked pair — the width axis', () => {
    // A column with a gutter: the two are 10px apart vertically, which is OUTSIDE the 8px
    // snap distance. Reusing that distance as the "are these a pair" test is what made this
    // axis read as dead, so this is the regression the neighbour gate exists for.
    const targets: SnapTargets = { windows: [r(600, 400)], screens: [] };
    const stacked = r(600 + 4, 400 + 200 + 10);
    expect(snapMovingBounds(stacked, targets).x).toBe(600);
  });

  it('does NOT align to a window that is nowhere near on the other axis', () => {
    // Same left edge available, but the target is parked far below: a magnet that fired here
    // would feel like a poltergeist.
    const targets: SnapTargets = { windows: [r(600, 5000)], screens: [] };
    const moving = r(604, 100);
    expect(snapMovingBounds(moving, targets).x).toBe(604);
  });
});

describe('snapDrag', () => {
  it('lets a snapped window be pulled free, which needs the un-snapped position tracked', () => {
    const s = newDragSession();
    // Land on the left screen edge.
    expect(snapDrag(s, r(5, 300), screen, 1000).x).toBe(0);

    // Now drag right in small steps. The OS offsets ITS rectangle — the snapped one we just
    // applied — so each proposal is only a few px from 0. Without accumulating the hand's
    // real travel, every one of these re-snaps to 0 and the window can never be freed.
    let t = 1000;
    let last = 0;
    for (const step of [4, 4, 4, 4]) {
      t += 16;
      last = snapDrag(s, r(last + step, 300), screen, t).x;
    }
    expect(last).toBeGreaterThan(SNAP_DISTANCE_PX);
  });

  it('holds the snap while the hand is still inside the escape distance', () => {
    const s = newDragSession();
    expect(snapDrag(s, r(5, 300), screen, 1000).x).toBe(0);
    expect(snapDrag(s, r(3, 300), screen, 1016).x).toBe(0);
  });

  it('starts fresh after a pause, so a new drag is not measured from the old one', () => {
    const s = newDragSession();
    snapDrag(s, r(5, 300), screen, 1000);
    const later = snapDrag(s, r(900, 300), screen, 1000 + DRAG_RESUME_MS + 1);
    expect(later.x).toBe(900);
  });
});
