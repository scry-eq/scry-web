// Magnetism for an overlay drag: line windows up with each other and with the screen edges.
// Pure geometry — no Electron — so the whole model is testable without a desktop.

export type Rect = { x: number; y: number; width: number; height: number };
type Axis = 'x' | 'y';
type Span = { near: number; far: number };

/**
 * How near an edge has to be before it pulls.
 *
 * Small deliberately: this is a distance the user must cross with the mouse to ESCAPE once it
 * has stuck, so every pixel of it is a pixel of "the window will not go where I am putting
 * it". 8 lands a hand-aimed drag flush without being felt as resistance.
 */
export const SNAP_DISTANCE_PX = 8;

/** A drag is considered finished after this long without a move. */
export const DRAG_RESUME_MS = 250;

const span = (r: Rect, axis: Axis): Span =>
  axis === 'x' ? { near: r.x, far: r.x + r.width } : { near: r.y, far: r.y + r.height };

const crossAxis = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');

const overlaps = (a: Span, b: Span): boolean => a.near < b.far && b.near < a.far;

/**
 * Are these two spans NEIGHBOURS — near enough that a user would call the windows a pair?
 *
 * NOT the snap distance, and conflating the two is a real defect rather than a tidiness
 * point. They answer different questions: "how near must an edge be before it pulls" is
 * resistance the user has to overcome, so it is tiny; "are these a pair" costs the user
 * nothing and only decides whether a candidate exists to be measured at all. With both set
 * to 8, two windows stacked with any normal gutter are two pixels outside the gate and no
 * edge-alignment is ever offered — that axis reads as dead. This gate scales with the windows
 * instead: a gap no larger than the smaller of the two spans still counts as adjacent.
 */
function neighbourly(a: Span, b: Span): boolean {
  if (overlaps(a, b)) return true;
  const gap = Math.max(b.near - a.far, a.near - b.far);
  return gap <= Math.min(a.far - a.near, b.far - b.near);
}

/**
 * The four near-edge positions that line `size` up with another WINDOW's span: abut after it,
 * abut before it, align near edges, align far edges. Abutment is how a column stacks with no
 * seam; alignment is what makes two windows' edges agree to the pixel.
 */
const windowStops = (t: Span, size: number): number[] => [t.far, t.near - size, t.near, t.far - size];

/** The two near-edge positions that sit `size` against a SCREEN's work area. */
const screenStops = (s: Span, size: number): number[] => [s.near, s.far - size];

export type SnapTargets = {
  /** Other windows this app owns. */
  windows: Rect[];
  /** Display work areas, so a snapped window lands beside the taskbar rather than under it. */
  screens: Rect[];
};

/**
 * Every position this drag could legitimately land on for `axis`. Each candidate is gated on
 * the OTHER axis: without that, dragging near the top of the screen would jump to the left
 * edge of a window parked at the bottom, and the magnet would feel like a poltergeist.
 */
function stopsOnAxis(moving: Rect, targets: SnapTargets, axis: Axis): number[] {
  const m = span(moving, axis);
  const cross = span(moving, crossAxis(axis));
  const size = m.far - m.near;
  const out: number[] = [];
  for (const t of targets.windows) {
    if (!neighbourly(cross, span(t, crossAxis(axis)))) continue;
    out.push(...windowStops(span(t, axis), size));
  }
  for (const s of targets.screens) {
    if (!overlaps(cross, span(s, crossAxis(axis)))) continue;
    out.push(...screenStops(span(s, axis), size));
  }
  return out;
}

/** The nearest legitimate position on `axis`, or null if nothing is within `distance`. */
function stopOnAxis(moving: Rect, targets: SnapTargets, axis: Axis, distance: number): number | null {
  const near = span(moving, axis).near;
  let best: number | null = null;
  let bestDelta = Infinity;
  for (const stop of stopsOnAxis(moving, targets, axis)) {
    const delta = Math.abs(stop - near);
    // Strictly-less keeps the generated order meaningful for ties: windows before screens,
    // and within a window, abutment before alignment.
    if (delta <= distance && delta < bestDelta) {
      best = stop;
      bestDelta = delta;
    }
  }
  return best;
}

/** `moving`, pulled onto any stop within `distance`. The axes are decided independently. */
export function snapMovingBounds(moving: Rect, targets: SnapTargets, distance = SNAP_DISTANCE_PX): Rect {
  const x = stopOnAxis(moving, targets, 'x', distance);
  const y = stopOnAxis(moving, targets, 'y', distance);
  return { ...moving, x: x ?? moving.x, y: y ?? moving.y };
}

export type DragSession = {
  /** Where the hand actually is, un-snapped. */
  virtual: Rect | null;
  /** What we last put on screen, which is what the OS offsets its next proposal from. */
  applied: Rect | null;
  at: number;
};

export const newDragSession = (): DragSession => ({ virtual: null, applied: null, at: 0 });

/**
 * One step of a drag. THE ACCUMULATION IS THE POINT, and without it a snapped window cannot
 * be pulled free.
 *
 * The OS move loop keeps its own rectangle and offsets it by each mouse message. Answer one
 * proposal with a snapped rectangle and that snapped rectangle becomes the loop's baseline —
 * the hand's travel since is gone, every later proposal is measured from the magnet, and
 * dragging away just re-snaps. The escape distance silently becomes infinite.
 *
 * So the hand's true position is tracked separately: each proposal contributes only its DELTA
 * from what we last applied, accumulated into `virtual`, and the snap is computed from that.
 * Pull far enough and `virtual` leaves the stop's range, which is what lets go.
 */
export function snapDrag(
  session: DragSession,
  proposal: Rect,
  targets: SnapTargets,
  now: number,
  distance = SNAP_DISTANCE_PX,
): Rect {
  const fresh = !session.virtual || !session.applied || now - session.at > DRAG_RESUME_MS;
  if (fresh) {
    session.virtual = proposal;
  } else {
    const dx = proposal.x - session.applied.x;
    const dy = proposal.y - session.applied.y;
    session.virtual = { ...session.virtual, x: session.virtual.x + dx, y: session.virtual.y + dy };
  }
  const snapped = snapMovingBounds(session.virtual, targets, distance);
  session.applied = snapped;
  session.at = now;
  return snapped;
}
