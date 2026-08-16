import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpawnStore } from '../state/store';
import type { SeqClient } from '../net/client';
import { SpawnType, type MapGeometry } from '@gen/seq/v1/events_pb';
import { useSpawnFilterStore, passesSpawnFilter } from '../state/spawnFilterStore';
import { classNameOf } from './classes';
import { conHex, conOf } from './concolor';
import { formatLoc, runtimeX, runtimeY } from '../lib/coords';

// Fallback color when con-color isn't applicable: doors/drops have no
// level, and PC/NPC fall through here only before the player level
// syncs. Corpses get con-colored alongside live spawns to match the
// spawn list.
const COLOR_BY_TYPE: Record<number, string> = {
  [SpawnType.PC]:         '#6ec4ff',
  [SpawnType.NPC]:        '#ff6b6b',
  [SpawnType.CORPSE_PC]:  '#7070a0',
  [SpawnType.CORPSE_NPC]: '#706060',
  [SpawnType.DOOR]:       '#c0c0c0',
  [SpawnType.DROP]:       '#ffe066',
};

// Spawn-point "+" color ramp — ports showeq-c's pickSpawnPointColor
// (mapicon.cpp:1316). With no learned cycle (death or diff unknown) the
// point is neutral gray. Once a cycle is known: a dark→bright-yellow
// ramp as the respawn approaches (QColor(age,age,0)), then overdue
// (age>220) flashes red ↔ gray, and a full cycle past due (age==255) is
// solid dark red. `age` is 255*(now-death)/diff clamped — the same
// value SpawnPointList uses to redden overdue rows. `flash` is the
// caller's 200 ms toggle (mirrors showeq-c's m_flash); legacy holds the
// age==255 dark red steady and only flashes the 221–254 band.
function spawnPointColor(deathS: number, diffS: number, flash: boolean): string {
  if (deathS === 0 || diffS === 0) return '#808080';
  const nowS = Date.now() / 1000;
  const age = Math.min(255, Math.max(0, Math.floor((255 * (nowS - deathS)) / diffS)));
  if (age === 255) return '#800000';
  if (age > 220) return flash ? '#ff0000' : '#808080';
  return `rgb(${age},${age},0)`;
}

// Pixel radius for hit-testing on spawn dots — slightly larger than the
// 3px drawn dot so the click target is forgiving. Mirrors showeq-c's
// 15px `closestSpawnToPoint` distance for clicks (map.cpp:2051), with a
// tighter 10px radius for hover so labels don't follow the cursor across
// dense spawn fields.
const CLICK_HIT_RADIUS = 12;
const HOVER_HIT_RADIUS = 10;
// Zoom slider mapping: integer 0..ZOOM_STEPS log-distributed across
// [ZOOM_MIN, ZOOM_MAX]. Integer step avoids any controlled-input
// precision drift between value prop and the snapped DOM value.
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 50;
const ZOOM_STEPS = 200;
const ZOOM_LN_MIN = Math.log(ZOOM_MIN);
const ZOOM_LN_MAX = Math.log(ZOOM_MAX);
const sliderToZoom = (s: number) =>
  Math.exp(ZOOM_LN_MIN + (s / ZOOM_STEPS) * (ZOOM_LN_MAX - ZOOM_LN_MIN));
const zoomToSlider = (z: number) =>
  Math.round(((Math.log(z) - ZOOM_LN_MIN) / (ZOOM_LN_MAX - ZOOM_LN_MIN)) * ZOOM_STEPS);
// Movement threshold (canvas px) below which a mouse-up after mouse-down
// is treated as a click rather than a drag-pan.
const DRAG_THRESHOLD = 4;

// `clickable: false` marks a hit that can be hovered (tooltip) but not
// click-selected — used for ground drops, which we let the user inspect
// without letting them steal selection off a nearby mob.
type SpawnHit = { id: number; x: number; y: number; clickable?: boolean };

// Exponential smoothing time constant (ms). The visual position closes
// (1 − 1/e) ≈ 63% of the gap to the target every TAU milliseconds,
// meaning it asymptotically approaches but never "arrives". This removes
// the stop-and-go produced by linear lerp: a linear lerp reaches 100% at
// durationMs and holds until the next update; exponential always moves,
// so there is no hold even when the next update is late or when the player
// pauses. Steady-state lag ≈ TAU / interval × step_size; at TAU=100ms and
// the observed avg 358ms player interval, lag ≈ 0.5 EQ — sub-pixel.
const LERP_TAU = 100; // ms

// Large jumps (gate, summon, zone-wide patrol restart) snap immediately.
// Lerping 500 EQ units looks like a slow glide-teleport; snapping is more
// honest. Threshold clears fast mounts (< 50 EQ/s) but catches any genuine
// in-game teleport (typically 500+ EQ units from the prior position).
const TELEPORT_SNAP_DIST = 150;

// --- Predictive (dead-reckoning) movement -------------------------------
// The follow smoother above eases toward the LAST-reported position, so it
// structurally trails the true position. Predictive mode instead projects
// each spawn forward along its reported velocity vector (vx, vy in world
// units, same coord system as position — see seq.v1 Pos), so the dot leads
// the stale packet and shows where the spawn actually is *now*.
//
// The model is a linear lerp from the current visual position toward the
// EXTRAPOLATED point (reported + v), advanced by `elapsed / intervalMs`.
// Anchoring the target to the reported position (plus the velocity lead)
// makes it self-correcting: every packet re-origins from the current visual
// position, so a bad prediction (mob stopped or turned) blends back over one
// interval instead of snapping. `intervalMs` is a per-spawn EMA of the
// observed packet cadence — the horizon the velocity vector is scaled to.
const PREDICT_INTERVAL_DEFAULT = 400; // ms — seed near the observed ~358ms player cadence
const PREDICT_INTERVAL_MIN = 100;     // clamp: ignore sub-100ms dual-fire bursts
const PREDICT_INTERVAL_MAX = 2000;    // clamp: a long gap shouldn't inflate the horizon
const PREDICT_INTERVAL_EMA = 0.3;     // smoothing weight for new interval samples
// Cap how far ahead we extrapolate (in intervals) before holding, so a
// dropped/late packet can't run the dot off along a stale vector. 1.5 lets
// the dot lead up to half an interval past the next expected packet.
const PREDICT_MAX_HORIZON = 1.5;
// Scalar on the velocity lead. vx/vy ship as EQ per-update deltas whose exact
// magnitude vs wall-clock cadence isn't calibrated (the hint line uses them
// raw); if live tuning shows the dot over-/under-leads, adjust this one knob.
const PREDICT_VELOCITY_GAIN = 1;

type SmoothedPos = {
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  // Reported velocity at the last update, world units per update interval
  // (screen convention, same as position). Only used in predictive mode.
  vx: number;
  vy: number;
  // Per-spawn EMA of the observed packet interval (ms), the horizon the
  // velocity lead is scaled against in predictive mode.
  intervalMs: number;
  updateTimeMs: number;
};

class PosSmoother {
  private readonly positions = new Map<number, SmoothedPos>();

  // Walk the current spawn set; stamp new ids, retarget moved ids, drop
  // disappeared ids. `players` is folded into the same map so the player
  // marker (drawn separately from the spawn loop) interpolates in lock
  // step with everyone else. `predictive` selects the interpolation model
  // for the re-origin capture; it must match the mode passed to posAt this
  // frame so the captured visual origin is consistent with what's rendered.
  sync(
    ids: Iterable<{ id: number; x: number; y: number; vx: number; vy: number }>,
    now: number,
    predictive: boolean,
  ) {
    const seen = new Set<number>();
    for (const { id, x, y, vx, vy } of ids) {
      seen.add(id);
      const cur = this.positions.get(id);
      if (!cur) {
        this.positions.set(id, {
          prevX: x, prevY: y, targetX: x, targetY: y,
          vx, vy, intervalMs: PREDICT_INTERVAL_DEFAULT, updateTimeMs: now,
        });
        continue;
      }
      if (cur.targetX === x && cur.targetY === y) {
        // Position unchanged, but velocity may have (e.g. a stop packet
        // reports the same position with zero velocity). Refresh it so the
        // predictor doesn't keep coasting on a stale vector.
        cur.vx = vx; cur.vy = vy;
        continue;
      }
      const dx = x - cur.targetX;
      const dy = y - cur.targetY;
      if (dx * dx + dy * dy > TELEPORT_SNAP_DIST * TELEPORT_SNAP_DIST) {
        cur.prevX = x; cur.prevY = y;
        cur.targetX = x; cur.targetY = y;
        cur.vx = vx; cur.vy = vy;
        cur.updateTimeMs = now;
        continue;
      }
      // Capture current visual position as the new origin so the transition
      // is seamless regardless of when the update arrives.
      const cp = this.posInternal(cur, now, predictive);
      // Track packet cadence for the predictor's extrapolation horizon. Kept
      // current in both modes so switching to predictive is warmed up.
      const dt = now - cur.updateTimeMs;
      if (dt > 0) {
        const clamped = Math.min(PREDICT_INTERVAL_MAX, Math.max(PREDICT_INTERVAL_MIN, dt));
        cur.intervalMs += (clamped - cur.intervalMs) * PREDICT_INTERVAL_EMA;
      }
      cur.prevX = cp.x;
      cur.prevY = cp.y;
      cur.targetX = x;
      cur.targetY = y;
      cur.vx = vx;
      cur.vy = vy;
      cur.updateTimeMs = now;
    }
    for (const id of this.positions.keys()) {
      if (!seen.has(id)) this.positions.delete(id);
    }
  }

  posAt(id: number, now: number, predictive: boolean): { x: number; y: number } | undefined {
    const sp = this.positions.get(id);
    return sp ? this.posInternal(sp, now, predictive) : undefined;
  }

  private posInternal(sp: SmoothedPos, now: number, predictive: boolean) {
    const elapsed = now - sp.updateTimeMs;
    if (predictive) {
      // Linear lerp from the re-origined prev toward the extrapolated point
      // (reported + velocity lead), advanced by elapsed/interval and clamped
      // to the lead horizon. With prev ≈ reported this reduces to
      // reported + v·alpha — pure dead reckoning along the velocity vector —
      // but when prev diverges (bad prior prediction) it corrects smoothly.
      const alpha = Math.min(
        PREDICT_MAX_HORIZON,
        Math.max(0, elapsed / sp.intervalMs),
      );
      const tx = sp.targetX + sp.vx * PREDICT_VELOCITY_GAIN;
      const ty = sp.targetY + sp.vy * PREDICT_VELOCITY_GAIN;
      return {
        x: sp.prevX + (tx - sp.prevX) * alpha,
        y: sp.prevY + (ty - sp.prevY) * alpha,
      };
    }
    const alpha = 1 - Math.exp(-elapsed / LERP_TAU);
    return {
      x: sp.prevX + (sp.targetX - sp.prevX) * alpha,
      y: sp.prevY + (sp.targetY - sp.prevY) * alpha,
    };
  }
}

export function MapCanvas({
  store,
  client,
  tick,
  selectedId,
  selectVersion,
  onSelect,
  trackPlayer,
  smoothMovement,
  predictiveMovement,
  panToXY,
  compact = false,
}: {
  store: SpawnStore;
  client: SeqClient | null;
  tick: number;
  selectedId: number | null;
  selectVersion: number;
  onSelect: (id: number | null) => void;
  trackPlayer: boolean;
  smoothMovement: boolean;
  predictiveMovement: boolean;
  panToXY?: { x: number; y: number; v: number } | null;
  /**
   * Rendering into a small floating overlay rather than a panel. The view controls and the
   * info box start COLLAPSED — they cost half the window at overlay sizes — and their
   * collapse state gets its own storage keys, so folding them here does not fold the main
   * window's map too.
   */
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Position smoother — survives across re-renders so we never lose
  // mid-flight lerp state when React re-runs the render-loop effect.
  const smootherRef = useRef<PosSmoother | null>(null);
  if (smootherRef.current === null) smootherRef.current = new PosSmoother();
  // Latest projected screen positions of spawns + the player, refreshed
  // every render frame. Read by mouse handlers to do hit-testing without
  // re-projecting the world.
  const spawnHitsRef = useRef<SpawnHit[]>([]);
  // Hover state lives in React because the tooltip is a DOM overlay, not
  // a canvas draw. Updated on mousemove from the same hits ref.
  const [hover, setHover] = useState<{
    id: number;
    screenX: number;
    screenY: number;
  } | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  // Pan & zoom kept in refs so mouse events don't churn React state. The
  // render loop reads them every frame. Zoom also surfaces as React state
  // so the slider input can render — `setZoom` mutates ref + state in
  // lockstep so the wheel handler can still read the previous scale
  // synchronously between rapid trackpad events.
  const [viewScale, setViewScale] = useState(1);
  const viewScaleRef = useRef(viewScale);
  const setZoom = (next: number) => {
    const clamped = Math.max(0.1, Math.min(50, next));
    viewScaleRef.current = clamped;
    setViewScale(clamped);
  };
  // Slider zoom: scale the existing pan offset by the same ratio so the
  // world point currently at screen-center stays at screen-center after
  // the zoom (the wheel handler does its own cursor-anchored adjustment).
  const setZoomAroundCenter = (next: number) => {
    const oldScale = viewScaleRef.current;
    const clamped = Math.max(0.1, Math.min(50, next));
    if (oldScale > 0) {
      const ratio = clamped / oldScale;
      panXRef.current *= ratio;
      panYRef.current *= ratio;
    }
    viewScaleRef.current = clamped;
    setViewScale(clamped);
  };
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const lastZoneRef = useRef('');
  const lastGeomRef = useRef<MapGeometry | undefined>(undefined);
  // Field-of-view radius around the player, in world units. Matches
  // showeq-c's MapIcons::m_fovDistance default (mapicon.cpp:797).
  const [fovDistance, setFovDistance] = useState(200);
  const fovDistanceRef = useRef(fovDistance);
  useEffect(() => { fovDistanceRef.current = fovDistance; }, [fovDistance]);
  // Selection drives a one-shot pan-to-center on the next render; the
  // render loop clears it after applying. Selection itself stays in props
  // so the highlight renders every frame.
  const pendingCenterRef = useRef<number | null>(null);
  const pendingCenterXYRef = useRef<{ x: number; y: number } | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  // When a selection originates from a click *on the map*, the view is
  // already showing the spawn — auto-recenter+zoom would just yank it
  // around. The click handler stamps this with the id it just selected
  // so the recenter effect below can skip exactly that change.
  const skipCenterForIdRef = useRef<number | null>(null);

  // On any (re-)select, request a center on next frame and bump zoom if
  // we're still zoomed out. Watching selectVersion as well as selectedId
  // means clicking the same row recenters.
  useEffect(() => {
    if (selectedId == null) return;
    if (skipCenterForIdRef.current === selectedId) {
      skipCenterForIdRef.current = null;
      return;
    }
    pendingCenterRef.current = selectedId;
    if (viewScaleRef.current < 3) setZoom(3);
  }, [selectedId, selectVersion]);

  useEffect(() => {
    if (panToXY == null) return;
    pendingCenterXYRef.current = { x: panToXY.x, y: panToXY.y };
    if (viewScaleRef.current < 3) setZoom(3);
  }, [panToXY]);

  // Visible layers — state because the toggle UI needs to re-render on
  // change. The render loop reads through a ref to avoid re-creating the
  // rAF loop on every toggle.
  const [visibleLayers, setVisibleLayers] = useState<Set<number>>(new Set());
  const visibleLayersRef = useRef(visibleLayers);
  useEffect(() => { visibleLayersRef.current = visibleLayers; }, [visibleLayers]);
  const chromeKey = (name: string): string => (compact ? `map.compact.${name}` : `map.${name}`);
  const readCollapsed = (name: string): boolean => {
    const v = localStorage.getItem(chromeKey(name));
    return v === null ? compact : v === '1';
  };
  const [overlayCollapsed, setOverlayCollapsed] = useState<boolean>(() =>
    readCollapsed('overlayCollapsed'),
  );
  // How solid the map's own background is. A docked panel is opaque; floating over the game
  // the point is to see through it, so `compact` starts translucent and the user can tune it.
  const [bgAlpha, setBgAlpha] = useState<number>(() => {
    const v = Number(localStorage.getItem(chromeKey('bgAlpha')));
    return Number.isFinite(v) && v > 0 ? Math.min(1, v) : compact ? 0.72 : 1;
  });
  const bgAlphaRef = useRef(bgAlpha);
  useEffect(() => {
    bgAlphaRef.current = bgAlpha;
    localStorage.setItem(chromeKey('bgAlpha'), String(bgAlpha));
  }, [bgAlpha]);
  useEffect(() => {
    localStorage.setItem(chromeKey('overlayCollapsed'), overlayCollapsed ? '1' : '0');
  }, [overlayCollapsed]);
  const [infoCollapsed, setInfoCollapsed] = useState<boolean>(() => readCollapsed('infoCollapsed'));
  const infoCollapsedRef = useRef(infoCollapsed);
  useEffect(() => {
    infoCollapsedRef.current = infoCollapsed;
    localStorage.setItem(chromeKey('infoCollapsed'), infoCollapsed ? '1' : '0');
  }, [infoCollapsed]);
  // Grid (mirrors showeq-c's MapData::paintGrid). Resolution in world
  // units — 500 matches mapcore.cpp:75. Default-on per the user request.
  const [showGrid, setShowGrid] = useState<boolean>(
    () => localStorage.getItem('map.showGrid') !== '0',
  );
  const showGridRef = useRef(showGrid);
  useEffect(() => {
    showGridRef.current = showGrid;
    localStorage.setItem('map.showGrid', showGrid ? '1' : '0');
  }, [showGrid]);
  const GRID_RESOLUTION = 500;
  // Spawn-point overlay (learned NPC respawn locations). Data already
  // arrives via the SpawnPoint envelope events that feed the Spawn
  // Points panel; this just toggles drawing the "+" markers on the map.
  const [showSpawnPoints, setShowSpawnPoints] = useState<boolean>(
    () => localStorage.getItem('map.showSpawnPoints') !== '0',
  );
  const showSpawnPointsRef = useRef(showSpawnPoints);
  useEffect(() => {
    showSpawnPointsRef.current = showSpawnPoints;
    localStorage.setItem('map.showSpawnPoints', showSpawnPoints ? '1' : '0');
  }, [showSpawnPoints]);
  // Velocity lines — a short darkgray line from each moving spawn pointing
  // in its travel direction, length proportional to speed. Ports showeq-c's
  // m_showVelocityLines (map.cpp:3955): drawLine(sx, sy, sx-deltaX,
  // sy-deltaY). The daemon ships vx/vy already negated into screen
  // convention (vx = -deltaX), so the same on-screen travel offset is just
  // (vx, vy). Drawn as raw pixels — zoom-independent, exactly like legacy.
  // Default on, matching legacy's VelocityLines pref default (map.cpp:1718).
  const [showVelocity, setShowVelocity] = useState<boolean>(
    () => localStorage.getItem('map.showVelocity') !== '0',
  );
  const showVelocityRef = useRef(showVelocity);
  useEffect(() => {
    showVelocityRef.current = showVelocity;
    localStorage.setItem('map.showVelocity', showVelocity ? '1' : '0');
  }, [showVelocity]);
  // Track-player: when on, the render loop pins pan so the player sits at
  // the canvas center. A manual drag temporarily suspends the pin (so you
  // can pan to look around), and releasing the drag snaps the view back to
  // the player on the next frame — see draggingRef. The persisted toggle is
  // never touched by panning. Mirrors showeq-c's tFollowPlayer (map.h:98).
  const trackPlayerRef = useRef(trackPlayer);
  useEffect(() => { trackPlayerRef.current = trackPlayer; }, [trackPlayer]);
  // True only while a pan drag is actively held. While set, the track-player
  // pin yields so the drag is visible; mouseup clears it and the next frame
  // re-pins to the player (the snap-back).
  const draggingRef = useRef(false);
  // When false the smoother still ingests updates (so re-enabling is
  // instant), but smoothedPos returns the raw fallback — dots and the
  // player snap directly to each daemon update.
  const smoothMovementRef = useRef(smoothMovement);
  useEffect(() => { smoothMovementRef.current = smoothMovement; }, [smoothMovement]);
  // Predictive (velocity-extrapolating) variant of smoothMovement. Inert
  // unless smoothMovement is also on — it only swaps the interpolation model.
  const predictiveMovementRef = useRef(predictiveMovement);
  useEffect(() => { predictiveMovementRef.current = predictiveMovement; }, [predictiveMovement]);
  // Render-rate cap. 0 = uncapped (every rAF tick paints). Otherwise we
  // gate the actual draw on `now - lastPaint >= 1000 / cap`. rAF still
  // fires at vsync so the throttle skips paints rather than sleeping —
  // browser already suspends rAF in inactive tabs.
  const [fpsCap, setFpsCap] = useState<number>(() => {
    const raw = localStorage.getItem('map.fpsCap');
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const fpsCapRef = useRef(fpsCap);
  useEffect(() => {
    fpsCapRef.current = fpsCap;
    localStorage.setItem('map.fpsCap', String(fpsCap));
  }, [fpsCap]);

  // Spawn-list filter mirror: SpawnList's category / hide-filtered / name
  // filter is shared via spawnFilterStore. MapCanvas applies the same
  // predicate so dots track rows. No selection-pierce — when the user
  // filters something out, it stays hidden even if it's the current
  // selection. The render loop reads via refs so filter toggles don't
  // restart the rAF (same pattern as showGridRef/fpsCapRef).
  const spawnFilter = useSpawnFilterStore();
  const spawnFilterRef = useRef(spawnFilter);
  useEffect(() => {
    spawnFilterRef.current = spawnFilter;
  }, [spawnFilter]);

  // Height filter — mirrors the EQ in-game map's height filter: when on, hide
  // map geometry, locations, and spawns whose Z falls outside a band centered
  // on the player (`above` units up, `below` units down, set separately). The
  // band needs the player's Z to anchor, so it's inert until the player is
  // known. Defaults to 10/10 (matching the in-game default applied on enable).
  const [heightFilter, setHeightFilter] = useState<boolean>(
    () => localStorage.getItem('map.heightFilter') === '1',
  );
  const heightFilterRef = useRef(heightFilter);
  useEffect(() => {
    heightFilterRef.current = heightFilter;
    localStorage.setItem('map.heightFilter', heightFilter ? '1' : '0');
  }, [heightFilter]);
  const readHeight = (key: string) => {
    const raw = localStorage.getItem(key);
    const n = raw == null ? 10 : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 10;
  };
  const [heightAbove, setHeightAbove] = useState<number>(() => readHeight('map.heightAbove'));
  const heightAboveRef = useRef(heightAbove);
  useEffect(() => {
    heightAboveRef.current = heightAbove;
    localStorage.setItem('map.heightAbove', String(heightAbove));
  }, [heightAbove]);
  const [heightBelow, setHeightBelow] = useState<number>(() => readHeight('map.heightBelow'));
  const heightBelowRef = useRef(heightBelow);
  useEffect(() => {
    heightBelowRef.current = heightBelow;
    localStorage.setItem('map.heightBelow', String(heightBelow));
  }, [heightBelow]);

  // Detect zone change → reset the view (zoom/pan) for the new zone.
  useEffect(() => {
    const z = store.zone();
    if (z === lastZoneRef.current) return;
    lastZoneRef.current = z;
    setZoom(1);
    panXRef.current = 0;
    panYRef.current = 0;
  }, [tick, store]);

  // Show all layers whenever the geometry itself changes. Keyed on the
  // geometry object (the store swaps in a fresh one per snapshot/zoneChanged),
  // NOT on the zone string: the active box's map often arrives in a LATER
  // same-zone update (its geometry loads after the initial no-geometry
  // snapshot on promote/box-switch). Gating on the zone string would leave
  // visibleLayers empty so the map renders blank until a zone change — the
  // "have to toggle boxes to get the map" bug.
  useEffect(() => {
    const geom = store.map();
    if (geom === lastGeomRef.current) return;
    lastGeomRef.current = geom;
    const layers = new Set<number>();
    if (geom) {
      for (const l of geom.lines) layers.add(l.layer);
      for (const l of geom.locations) layers.add(l.layer);
    }
    setVisibleLayers(layers);
  }, [tick, store]);

  // Pre-fill the height-filter band from the map's Brewall height hint, ONCE
  // per zone. Gated on the zone string — NOT the geometry object — because
  // same-zone geom churn (box switch, snapshot re-emit, map-package reselect,
  // or the active box's map arriving in a later same-zone update) swaps the
  // geom object repeatedly, and re-applying on every swap clobbered a value
  // the user had since adjusted. Critically, we only touch the band when a
  // hint is actually present: the old code forced 10/10 on every hintless
  // swap, which wiped both the just-applied hint and the user's persisted
  // value — the "height filter resets on load" bug. With no hint we leave the
  // band alone (its default already comes from the persisted-localStorage
  // useState init). The latch is set only after a hint lands, so a hint that
  // arrives in a LATER same-zone update than the zone-change still applies.
  const hintAppliedZoneRef = useRef<string>('');
  useEffect(() => {
    const zone = store.zone();
    if (zone === hintAppliedZoneRef.current) return;
    const geom = store.map();
    const hintAbove = geom?.heightHintAbove ?? 0;
    if (hintAbove <= 0) return; // no hint yet — may arrive later this zone
    hintAppliedZoneRef.current = zone;
    setHeightAbove(hintAbove);
    setHeightBelow(geom?.heightHintBelow ?? 0);
  }, [tick, store]);

  // Sync canvas backing-store size to its container, DPR-aware.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const sync = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const obs = new ResizeObserver(sync);
    obs.observe(wrap);
    return () => obs.disconnect();
  }, []);

  // Mouse: drag to pan, click to select, hover to show name. Wheel zooms
  // (cursor-anchored).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Track the down-event so we can distinguish click (small movement)
    // from drag-pan. Pan starts on mousedown but a final movement under
    // DRAG_THRESHOLD also counts as a click.
    let dragOrigin: { x: number; y: number } | null = null;
    let downAt: { clientX: number; clientY: number } | null = null;
    let movedFar = false;

    const findHit = (
      clientX: number,
      clientY: number,
      radius: number,
      clickableOnly = false,
    ) => {
      const rect = canvas.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const r2 = radius * radius;
      let best: SpawnHit | null = null;
      let bestD2 = Infinity;
      for (const h of spawnHitsRef.current) {
        if (clickableOnly && h.clickable === false) continue;
        const dx = h.x - cx;
        const dy = h.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2 && d2 < bestD2) {
          bestD2 = d2;
          best = h;
        }
      }
      return best;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragOrigin = {
        x: e.clientX - panXRef.current,
        y: e.clientY - panYRef.current,
      };
      downAt = { clientX: e.clientX, clientY: e.clientY };
      movedFar = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (dragOrigin && downAt) {
        const dx = e.clientX - downAt.clientX;
        const dy = e.clientY - downAt.clientY;
        if (!movedFar && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
          movedFar = true;
          // Suspend the track-player pin for the duration of the drag so the
          // pan is visible. mouseup clears this and the view snaps back.
          draggingRef.current = true;
        }
        if (movedFar) {
          panXRef.current = e.clientX - dragOrigin.x;
          panYRef.current = e.clientY - dragOrigin.y;
          // Pan invalidates whatever was under the cursor before.
          setHover((h) => (h ? null : h));
        }
        return;
      }
      // Hover hit-test (only when not dragging).
      const hit = findHit(e.clientX, e.clientY, HOVER_HIT_RADIUS);
      if (!hit) {
        setHover((h) => (h ? null : h));
        return;
      }
      // Canvas-local coords; wrap div is `relative` so absolute children
      // position against the same origin.
      setHover({ id: hit.id, screenX: hit.x, screenY: hit.y });
    };
    const onMouseUp = (e: MouseEvent) => {
      const wasClick = dragOrigin != null && !movedFar && e.button === 0;
      dragOrigin = null;
      downAt = null;
      // End of a pan drag: re-arm the track-player pin so the next frame
      // snaps the view back to the player.
      draggingRef.current = false;
      if (!wasClick) return;
      // Click: select nearest spawn within CLICK_HIT_RADIUS, or clear
      // selection on empty space (matches the showeq-c behavior of
      // requiring a hit but pairs well with the SpawnList row toggle).
      const hit = findHit(e.clientX, e.clientY, CLICK_HIT_RADIUS, true);
      if (hit) {
        skipCenterForIdRef.current = hit.id;
        onSelectRef.current(hit.id);
      }
    };
    const onMouseLeave = () => setHover(null);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Per-event multiplier scaled by deltaY magnitude so trackpad
      // pinch (many small deltas) doesn't compound the way mouse wheel
      // detents (one big delta per click) does. deltaY is normalized
      // against a typical mouse-wheel detent (~100) and clamped so a
      // single huge scroll burst can't blow past the bounds in one tick.
      const norm = Math.min(1, Math.abs(e.deltaY) / 100);
      const step = 0.1 * norm;
      const factor = e.deltaY < 0 ? 1 + step : 1 / (1 + step);
      const oldScale = viewScaleRef.current;
      const newScale = Math.max(0.1, Math.min(50, oldScale * factor));
      // When tracking, pan is overridden every frame to pin the player —
      // cursor-anchored zoom would just flicker before the tracker wins.
      // Zoom around the player (already at canvas center) instead.
      if (trackPlayerRef.current) {
        setZoom(newScale);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Keep the world point under the cursor stationary: shift pan by the
      // change in canvas-space distance from center after scaling.
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const offX = cx - centerX - panXRef.current;
      const offY = cy - centerY - panYRef.current;
      const ratio = newScale / oldScale;
      panXRef.current -= offX * (ratio - 1);
      panYRef.current -= offY * (ratio - 1);
      setZoom(newScale);
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    // Sliding 1-second frame counter for the HUD's fps line. rAF fires
    // continuously, so this measures actual paint cadence (not just
    // state changes the way iced-miseru's cache-driven counter does).
    const fpsStats = { count: 0, lastReset: 0, fps: 0 };
    // Cumulative paint deadline. Resetting to `now` each paint aliases
    // when the display refresh isn't a multiple of the cap — e.g. 90Hz
    // + cap=60 drops to 45fps because two 11.11ms rAFs land before the
    // 16.67ms gate opens, making every other paint slip a vsync.
    // Accumulating the deadline keeps the cadence on the cap, not on
    // whichever rAF first crossed the threshold.
    let nextPaint = 0;
    const render = () => {
      const cap = fpsCapRef.current;
      if (cap > 0) {
        const now = performance.now();
        const interval = 1000 / cap;
        // 0.5ms slack so a vsync that lands a hair early still counts.
        if (now < nextPaint - 0.5) {
          frame = requestAnimationFrame(render);
          return;
        }
        // First frame or fell more than one interval behind: resync to
        // now. Otherwise advance by exactly `interval` to hold cadence.
        nextPaint = nextPaint === 0 || now > nextPaint + interval
          ? now + interval
          : nextPaint + interval;
      }
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      // Clear first: an alpha fill drawn over the previous frame would accumulate until the
      // background was opaque again, taking the ghost of every earlier frame with it.
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = `rgba(10, 14, 18, ${bgAlphaRef.current})`;
      ctx.fillRect(0, 0, w, h);

      const geom = store.map();
      const spawns = store.all();
      const player = store.player();
      const visible = visibleLayersRef.current;

      // Height-filter band, anchored on the player's Z. Z is raw EQ height
      // (not negated like X/Y; see protoencoder fillPos), so larger Z is up.
      // Inert with no player Z; when off, the infinite band makes inBand a
      // no-op so callers can stay branch-light.
      const playerZ = player?.pos?.z;
      const heightOn = heightFilterRef.current && playerZ != null;
      const zMin = heightOn ? playerZ - heightBelowRef.current : -Infinity;
      const zMax = heightOn ? playerZ + heightAboveRef.current : Infinity;
      const inBand = (z: number) => z >= zMin && z <= zMax;

      // Refresh smoother against the latest store state — adds new ids,
      // retargets moved ids, prunes removed ids. `pos` may be missing on
      // a freshly-spawned record before the first OP_ClientUpdate (rare
      // but observed); skip those so we don't peg them at (0, 0).
      const smoother = smootherRef.current!;
      const animNow = performance.now();
      // Predictive extrapolation is a variant of smoothing — only meaningful
      // while smoothing is on. Compute the mode once so sync (re-origin) and
      // posAt (render) agree within the frame.
      const predictive = smoothMovementRef.current && predictiveMovementRef.current;
      smoother.sync(
        (function* () {
          for (const s of spawns) {
            if (!s.pos) continue;
            yield { id: s.id, x: s.pos.x, y: s.pos.y, vx: s.pos.vx, vy: s.pos.vy };
          }
        })(),
        animNow,
        predictive,
      );
      const smoothedPos = (id: number, fallback: { x: number; y: number }) =>
        (smoothMovementRef.current ? smoother.posAt(id, animNow, predictive) : fallback) ?? fallback;

      // Pick viewport bounds: zone geometry → spawn-derived → fallback box.
      let minX: number, minY: number, maxX: number, maxY: number;
      if (geom && (geom.minX !== 0 || geom.maxX !== 0)) {
        minX = geom.minX; minY = geom.minY;
        maxX = geom.maxX; maxY = geom.maxY;
      } else if (spawns.length > 0) {
        minX = minY = Infinity; maxX = maxY = -Infinity;
        for (const s of spawns) {
          const x = s.pos?.x ?? 0, y = s.pos?.y ?? 0;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      } else {
        minX = -1000; minY = -1000; maxX = 1000; maxY = 1000;
      }

      const zoneW = Math.max(1, maxX - minX);
      const zoneH = Math.max(1, maxY - minY);
      const baseScale = Math.min(w / zoneW, h / zoneH) * 0.92;
      const scale = baseScale * viewScaleRef.current;
      const ccx = (minX + maxX) / 2;
      const ccy = (minY + maxY) / 2;
      // Coords arrive in screen convention (+X right, +Y down) — the
      // daemon pre-negates EQ runtime coords at proto serialization time
      // (see scry-cpp/src/protoencoder.cpp fillPos / fillMapGeometry,
      // and the seq.v1 Pos message comment). Projection is identity on
      // the coords; pan adds an additional screen-pixel offset.
      // Apply a pending center request (from a SpawnList click). We need
      // ccx/ccy/scale to be known before computing pan, hence handling it
      // here rather than in the selection effect.
      if (pendingCenterRef.current != null) {
        const target = spawns.find((s) => s.id === pendingCenterRef.current);
        if (target?.pos) {
          const tp = smoothedPos(target.id, target.pos);
          panXRef.current = -(tp.x - ccx) * scale;
          panYRef.current = -(tp.y - ccy) * scale;
        }
        pendingCenterRef.current = null;
      }
      if (pendingCenterXYRef.current != null) {
        const { x, y } = pendingCenterXYRef.current;
        panXRef.current = -(x - ccx) * scale;
        panYRef.current = -(y - ccy) * scale;
        pendingCenterXYRef.current = null;
      }

      // Track-player: pin pan so the player stays at the canvas center.
      // Wins over pendingCenter — clicking a far spawn while tracking
      // bumps zoom (selection effect) but keeps the view on the player.
      // Uses the smoothed player position so the camera glides with the
      // marker instead of snapping at each daemon update. Suspended while a
      // manual pan drag is held (draggingRef) so the user can look around;
      // releasing the drag re-pins here and snaps the view back.
      if (trackPlayerRef.current && !draggingRef.current && player?.pos) {
        const pp = smoothedPos(player.id, player.pos);
        panXRef.current = -(pp.x - ccx) * scale;
        panYRef.current = -(pp.y - ccy) * scale;
      }

      const project = (x: number, y: number): [number, number] => [
        w / 2 + (x - ccx) * scale + panXRef.current,
        h / 2 + (y - ccy) * scale + panYRef.current,
      ];

      // Grid (underlay). Ports MapData::paintGrid (mapcore.cpp:1666):
      // vertical+horizontal lines at every gridResolution world units,
      // tick labels at each intersection. Only iterate the lines whose
      // screen-space position falls within the canvas to keep large
      // zones cheap.
      if (showGridRef.current) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#194819';
        ctx.font = '10px system-ui';
        ctx.fillStyle = '#e1c819';
        // World-space bounds of the visible viewport. Inverting the
        // Inverse of project(): world_x = ccx + (sx - w/2 - panX) / scale.
        const worldLeft   = ccx + (0 - w / 2 - panXRef.current) / scale;
        const worldRight  = ccx + (w - w / 2 - panXRef.current) / scale;
        const worldTop    = ccy + (0 - h / 2 - panYRef.current) / scale;
        const worldBottom = ccy + (h - h / 2 - panYRef.current) / scale;
        // Project flips both axes (see calcXOffsetI mirror), so worldLeft
        // is actually the larger world-x. Normalize.
        const wxMin = Math.min(worldLeft, worldRight);
        const wxMax = Math.max(worldLeft, worldRight);
        const wyMin = Math.min(worldTop, worldBottom);
        const wyMax = Math.max(worldTop, worldBottom);
        const startX = Math.ceil(wxMin / GRID_RESOLUTION) * GRID_RESOLUTION;
        const startY = Math.ceil(wyMin / GRID_RESOLUTION) * GRID_RESOLUTION;
        // Grid line geometry stays in screen convention (project() is
        // identity on the coords), but the printed axis labels are flipped
        // to EQ /loc / runtime convention so they match the tooltip, the
        // status bar, and in-game /loc — see lib/coords.
        for (let gx = startX; gx <= wxMax; gx += GRID_RESOLUTION) {
          const [sx] = project(gx, 0);
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, h);
          ctx.stroke();
          ctx.fillText(String(runtimeX(gx)), sx + 2, h - 2);
        }
        for (let gy = startY; gy <= wyMax; gy += GRID_RESOLUTION) {
          const [, sy] = project(0, gy);
          ctx.beginPath();
          ctx.moveTo(0, sy);
          ctx.lineTo(w, sy);
          ctx.stroke();
          ctx.fillText(String(runtimeY(gy)), 2, sy - 2);
        }
      }

      if (geom) {
        ctx.lineWidth = 1;
        for (const line of geom.lines) {
          if (!visible.has(line.layer)) continue;
          const n = line.x.length;
          if (n < 2) continue;
          ctx.strokeStyle = line.color || '#4a6070';
          const zlen = line.z.length;
          // Per-point Z (M-lines, zlen === n): break the polyline wherever it
          // leaves the band so only the in-band portion draws.
          if (heightOn && zlen >= 2) {
            ctx.beginPath();
            let penDown = false;
            for (let i = 0; i < n; i++) {
              if (inBand(line.z[i])) {
                const [px, py] = project(line.x[i], line.y[i]);
                if (penDown) ctx.lineTo(px, py);
                else { ctx.moveTo(px, py); penDown = true; }
              } else {
                penDown = false;
              }
            }
            ctx.stroke();
            continue;
          }
          // Single shared Z (L-lines, zlen === 1): whole line in or out. Lines
          // with no Z (zlen === 0) carry no height info and always draw.
          if (heightOn && zlen === 1 && !inBand(line.z[0])) continue;
          ctx.beginPath();
          const [sx, sy] = project(line.x[0], line.y[0]);
          ctx.moveTo(sx, sy);
          for (let i = 1; i < n; i++) {
            const [px, py] = project(line.x[i], line.y[i]);
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }

        ctx.font = '10px system-ui';
        for (const loc of geom.locations) {
          if (!visible.has(loc.layer)) continue;
          // Locations without a valid Z carry no height info → always show.
          if (heightOn && loc.zValid && !inBand(loc.z)) continue;
          const [lx, ly] = project(loc.x, loc.y);
          ctx.fillStyle = loc.color || 'rgba(255,255,255,0.5)';
          ctx.fillText(loc.name, lx + 3, ly);
        }
      }

      // Spawn points (learned NPC respawn locations) — ports showeq-c's
      // paintSpawnPoints + tIconTypeSpawnPoint (map.cpp:4228,
      // mapicon.cpp:1255): a small age-colored "+" at each promoted
      // point. Drawn under the live spawn dots so an active mob sitting
      // on its point stays on top. Respects the height-filter band like
      // geometry and spawns do.
      if (showSpawnPointsRef.current) {
        ctx.lineWidth = 1;
        // 200 ms flash phase for overdue points — mirrors showeq-c's
        // m_flash timer. The rAF loop runs continuously (gated only by
        // the FPS cap, which stays well above 5 Hz), so this animates
        // without any extra timer.
        const spFlash = animNow % 400 < 200;
        for (const sp of store.allSpawnPoints()) {
          if (heightOn && !inBand(sp.z)) continue;
          const [px, py] = project(sp.x, sp.y);
          ctx.strokeStyle = spawnPointColor(Number(sp.deathTimeS), Number(sp.diffTimeS), spFlash);
          ctx.beginPath();
          ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3);
          ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py);
          ctx.stroke();
        }
      }

      // Spawns.
      const selId = selectedIdRef.current;
      // Prefer PlayerStats.level over the Spawn record: the daemon never
      // resends the player's Spawn after a ding, so Spawn.level is frozen
      // at zone-in. PlayerStats.level is bumped on OP_LevelUpdate.
      const pLevel = store.stats()?.level ?? player?.level ?? 0;
      // Rebuild hit-test list each frame; we add the player below.
      const hits: SpawnHit[] = [];
      let selectedScreen: { x: number; y: number } | null = null;
      for (const s of spawns) {
        if (s.id === player?.id) continue;
        // Doors/drops are scenery: the shared spawn filter excludes them
        // (SpawnList honors that too), but on the map we draw them with
        // their own glyphs. Bypass only the door/drop exclusion here —
        // they carry no level/category to filter on anyway — and below
        // we keep them out of the hit-test so they stay non-clickable
        // (the reason they were filtered off the map originally).
        const isScenery = s.type === SpawnType.DOOR || s.type === SpawnType.DROP;
        // List-filter mirror: hideFiltered (FILTERED_BIT), category, and
        // name-needle all apply. NO selection-pierce — when the user
        // filters something out (via SpawnList controls), it's hidden on
        // the map too, even if it's the current selection. (Height filter
        // still pierces below; that's a separate concern.)
        if (!isScenery && !passesSpawnFilter(s, spawnFilterRef.current)) continue;
        // Height filter: drop out-of-band spawns from the draw and from
        // hit-testing (this precedes the hits.push below). The selected spawn
        // always pierces the filter so its dot + the magenta line stay visible
        // even on another floor. Spawns without a position can't be filtered
        // by Z, so they fall through unchanged.
        if (heightOn && s.pos && s.id !== selId && !inBand(s.pos.z)) continue;
        const sp = smoothedPos(s.id, s.pos ?? { x: 0, y: 0 });
        const [px, py] = project(sp.x, sp.y);
        // Scenery interactivity: doors stay fully out of the hit-test;
        // drops are hoverable (tooltip — "what's on the ground?") but
        // marked non-clickable so they never steal a selection from a
        // nearby mob. Live spawns are fully interactive.
        if (!isScenery) hits.push({ id: s.id, x: px, y: py });
        else if (s.type === SpawnType.DROP)
          hits.push({ id: s.id, x: px, y: py, clickable: false });
        if (s.id === selId) selectedScreen = { x: px, y: py };
        // Group-member ring (under selection ring so selection wins).
        if (store.isGroupSpawn(s.id)) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (s.id === selId) {
          ctx.strokeStyle = '#ffd24a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Velocity line — darkgray vector in the travel direction, length
        // proportional to speed. vx/vy arrive pre-negated into screen
        // convention (see seq.v1 Pos), so the on-screen travel offset is
        // exactly (vx, vy) — identical to showeq-c's (-deltaX, -deltaY)
        // screen offset (map.cpp:3955). Raw pixel length, zoom-independent,
        // like legacy. Anchored at the smoothed dot (px,py); direction/speed
        // read from the raw pos (velocity isn't smoothed).
        if (showVelocityRef.current && s.pos && (s.pos.vx || s.pos.vy)) {
          ctx.strokeStyle = '#808080';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + s.pos.vx, py + s.pos.vy);
          ctx.stroke();
        }
        // Per-type marker glyph — ports showeq-c's default MapIcons
        // table (mapicon.cpp:593-757). NPCs and live PCs carry a
        // con-colored fill; corpses/doors/drops are fixed-color outline
        // glyphs (no con fill) so they read as objects, not threats.
        // All use the regular 6px (radius-3) footprint except doors,
        // which legacy draws at tIconSizeTiny (2px).
        const fill =
          pLevel > 0 && s.level > 0
            ? conHex(conOf(pLevel, s.level))
            : COLOR_BY_TYPE[s.type] ?? '#ffffff';
        // Until the player is identified (player_id only arrives in the
        // Snapshot; undefined at char-select / before zone-in), don't
        // single PCs out as "other players" — our own character is a PC
        // and would otherwise flash as a magenta square. Render PCs as
        // plain con dots in that window; once we know which spawn is us,
        // it's skipped above (drawn as the white player marker) and real
        // other-PCs become squares.
        const glyphType =
          s.type === SpawnType.PC && !player ? SpawnType.NPC : s.type;
        switch (glyphType) {
          case SpawnType.PC:
            // Square, con fill, magenta outline (tIconTypeSpawnPlayer).
            ctx.fillStyle = fill;
            ctx.fillRect(px - 3, py - 3, 6, 6);
            ctx.strokeStyle = '#ff00ff';
            ctx.lineWidth = 1;
            ctx.strokeRect(px - 3, py - 3, 6, 6);
            break;
          case SpawnType.CORPSE_PC:
            // Hollow yellow square, thick border, no fill
            // (tIconTypeSpawnPlayerCorpse: NoBrush, yellow pen w2).
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            ctx.strokeRect(px - 3, py - 3, 6, 6);
            break;
          case SpawnType.CORPSE_NPC:
            // Cyan plus/cross (tIconTypeSpawnNPCCorpse: Plus, cyan pen).
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3);
            ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py);
            ctx.stroke();
            break;
          case SpawnType.DOOR:
            // Tiny hollow brown square (tIconTypeDoor: NoBrush, pen
            // QColor(110,60,0), tIconSizeTiny → 2px).
            ctx.strokeStyle = '#6e3c00';
            ctx.lineWidth = 1;
            ctx.strokeRect(px - 1, py - 1, 2, 2);
            break;
          case SpawnType.DROP:
            // Yellow X (tIconTypeDrop: X, yellow pen).
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px - 3, py - 3); ctx.lineTo(px + 3, py + 3);
            ctx.moveTo(px - 3, py + 3); ctx.lineTo(px + 3, py - 3);
            ctx.stroke();
            break;
          default:
            // NPC (and unspecified): con-colored circle
            // (tIconTypeSpawnNPC: Circle, spawn-color brush).
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
        }
      }

      // Player marker + viewport (FOV ellipse) + view direction (yellow
      // center line + red cone). Ports showeq-c's paintPlayerBackground +
      // paintPlayerView from showeq-c/src/map.cpp:3530-3593.
      if (player?.pos) {
        const pp = smoothedPos(player.id, player.pos);
        const [px, py] = project(pp.x, pp.y);
        const scaledFov = fovDistanceRef.current * scale;
        if (player.id) hits.push({ id: player.id, x: px, y: py });

        // Magenta line from player to selected spawn — ports
        // tIconTypeItemSelected's setLine0(true, Qt::magenta) +
        // MapIcons::paintIcon (showeq-c/src/mapicon.cpp:689,941-947).
        if (selectedScreen && selId !== player.id) {
          ctx.strokeStyle = '#ff00ff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(selectedScreen.x, selectedScreen.y);
          ctx.stroke();
        }

        // FOV background ellipse (semi-transparent fill, drawn under the
        // marker for context).
        ctx.fillStyle = 'rgba(80, 80, 80, 0.22)';
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, scaledFov, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Selection highlight ring.
        if (player.id === selId) {
          ctx.strokeStyle = '#ffd24a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 9, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Player dot.
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Heading is sent as compass degrees 0..359 (see seq.v1 Pos.heading
        // — the daemon converts from EQ's raw 12-bit / 8-bit forms before
        // serializing). showeq-c's paintPlayerView formula then maps that
        // to a canvas-space angle (sin → +X right, cos → +Y down, 0°↑).
        const headingDegrees = player.pos.heading ?? 0;
        const angle = ((360 - headingDegrees - 180) / 360) * 2 * Math.PI;

        const fovHalfAngle = (Math.PI * 2) * 0.25 / 2; // 45° each side

        // Center line — yellow.
        ctx.strokeStyle = '#ffd200';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(
          px + Math.sin(angle) * scaledFov,
          py + Math.cos(angle) * scaledFov,
        );
        ctx.stroke();

        // Cone edges — red. Each line starts at the circle perimeter in its
        // own direction so neither edge visually exits the circle.
        const circleR = 5;
        ctx.strokeStyle = '#ff3030';
        ctx.lineWidth = 1.25;
        for (const side of [-1, 1]) {
          const edgeAngle = angle + side * fovHalfAngle;
          ctx.beginPath();
          ctx.moveTo(px + Math.sin(edgeAngle) * circleR, py + Math.cos(edgeAngle) * circleR);
          ctx.lineTo(px + Math.sin(edgeAngle) * scaledFov, py + Math.cos(edgeAngle) * scaledFov);
          ctx.stroke();
        }
      }

      const now = performance.now();
      if (fpsStats.lastReset === 0) fpsStats.lastReset = now;
      fpsStats.count++;
      const elapsed = now - fpsStats.lastReset;
      if (elapsed >= 1000) {
        fpsStats.fps = (fpsStats.count * 1000) / elapsed;
        fpsStats.count = 0;
        fpsStats.lastReset = now;
      }

      if (!infoCollapsedRef.current) {
        ctx.font = '12px system-ui';
        const zoneLabel = store.zoneLongName() || store.zone() || '(none)';
        const lines = [
          `zone: ${zoneLabel}`,
          `spawns: ${spawns.length}`,
          `seq: ${store.seq()}`,
          `zoom: ${viewScaleRef.current.toFixed(2)}x`,
          `fps: ${fpsStats.fps.toFixed(0)}`,
        ];
        let maxW = 0;
        for (const t of lines) {
          const tw = ctx.measureText(t).width;
          if (tw > maxW) maxW = tw;
        }
        const padX = 6;
        const padY = 5;
        const lineH = 16;
        const boxX = 4;
        const boxY = 4;
        const boxW = Math.ceil(maxW) + padX * 2;
        const boxH = lines.length * lineH + padY * 2;
        ctx.fillStyle = 'rgba(15, 22, 28, 0.78)';
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], boxX + padX, boxY + padY + (i + 1) * lineH - 4);
        }
      }

      // Publish hits for hit-testing in mouse handlers. Done last so any
      // dot painted this frame is selectable on the next event.
      spawnHitsRef.current = hits;

      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [store]);

  // Layers present in current geometry — derives the toggle UI list.
  const availableLayers = useMemo(() => {
    void tick;
    const s = new Set<number>();
    const geom = store.map();
    if (geom) {
      for (const l of geom.lines) s.add(l.layer);
      for (const l of geom.locations) s.add(l.layer);
    }
    return Array.from(s).sort((a, b) => a - b);
  }, [tick, store]);

  // Map provider packages — read from the store on each tick re-render
  // (same pattern as the other store-backed panels). The list is
  // replaced wholesale by each MapPackagesUpdate, so reading it here is
  // cheap. Selecting a package makes the daemon re-emit ZoneChanged with
  // the new geometry, which the render loop picks up automatically.
  void tick;
  const mapPackages = store.mapPackages();
  const activeMapPackage = store.activeMapPackage();

  const toggleLayer = (layer: number) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  const allOn = () => setVisibleLayers(new Set(availableLayers));
  const allOff = () => setVisibleLayers(new Set());

  const resetView = () => {
    setZoom(1);
    panXRef.current = 0;
    panYRef.current = 0;
  };

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full select-none ${compact ? '' : 'bg-bg-base'}`}
    >
      <canvas
        ref={canvasRef}
        className="block cursor-grab active:cursor-grabbing"
      />
      <HoverTip store={store} hover={hover} />
      <div
        className={
          'absolute right-2 top-2 rounded border border-border bg-bg-panel/95 text-xs shadow-md backdrop-blur ' +
          (overlayCollapsed ? '' : 'min-w-[160px] p-2')
        }
      >
        <div
          className={
            'flex items-center justify-between gap-2 ' +
            (overlayCollapsed ? 'p-1' : 'mb-1')
          }
        >
          <button
            type="button"
            onClick={() => setOverlayCollapsed((c) => !c)}
            className="text-muted-foreground hover:text-foreground"
            title={overlayCollapsed ? 'Expand view options' : 'Collapse view options'}
            aria-label={overlayCollapsed ? 'Expand view options' : 'Collapse view options'}
          >
            {overlayCollapsed ? '▸' : '▾'}
          </button>
          {!overlayCollapsed && (
            <>
              <span className="flex-1 font-medium text-foreground">View</span>
              <button
                type="button"
                onClick={resetView}
                className="rounded border border-border bg-bg-alt px-1.5 py-0.5 text-[10px] text-foreground hover:bg-bg-base"
                title="Reset zoom + pan"
              >
                reset view
              </button>
            </>
          )}
        </div>
        {!overlayCollapsed && (
        <>
        <label className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="w-7 shrink-0">FOV</span>
          <input
            type="range"
            min={20}
            max={1200}
            step={20}
            value={fovDistance}
            onChange={(e) => setFovDistance(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="w-8 shrink-0 text-right tabular-nums">{fovDistance}</span>
        </label>
        <label className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="w-7 shrink-0">Zoom</span>
          <input
            type="range"
            min={0}
            max={ZOOM_STEPS}
            step={1}
            value={zoomToSlider(viewScale)}
            onChange={(e) => setZoomAroundCenter(sliderToZoom(Number(e.target.value)))}
            onInput={(e) => setZoomAroundCenter(sliderToZoom(Number((e.target as HTMLInputElement).value)))}
            className="flex-1 accent-blue-500"
          />
          <span className="w-8 shrink-0 text-right tabular-nums">{viewScale.toFixed(2)}x</span>
        </label>
        {compact && (
          <label className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="w-7 shrink-0">Fade</span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(bgAlpha * 100)}
              onChange={(e) => setBgAlpha(Number(e.target.value) / 100)}
              onInput={(e) => setBgAlpha(Number((e.target as HTMLInputElement).value) / 100)}
              className="flex-1 accent-blue-500"
              title="How solid the map background is over the game"
            />
            <span className="w-8 shrink-0 text-right tabular-nums">
              {Math.round(bgAlpha * 100)}%
            </span>
          </label>
        )}
        <label className="mb-2 flex items-center gap-1 text-[11px] text-foreground">
          <span className="w-7 shrink-0 text-muted-foreground">FPS</span>
          <select
            value={fpsCap}
            onChange={(e) => setFpsCap(Number(e.target.value))}
            className="flex-1 rounded border border-border bg-bg-alt px-1 py-0.5 text-[11px] text-foreground"
          >
            <option value={0}>uncap</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label className="mb-2 flex cursor-pointer items-center gap-1 text-[11px] text-foreground">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
            className="h-3 w-3 accent-blue-500"
          />
          Grid
        </label>
        <label className="mb-2 flex cursor-pointer items-center gap-1 text-[11px] text-foreground">
          <input
            type="checkbox"
            checked={showSpawnPoints}
            onChange={(e) => setShowSpawnPoints(e.target.checked)}
            className="h-3 w-3 accent-blue-500"
          />
          Spawn points
        </label>
        <label className="mb-2 flex cursor-pointer items-center gap-1 text-[11px] text-foreground">
          <input
            type="checkbox"
            checked={showVelocity}
            onChange={(e) => setShowVelocity(e.target.checked)}
            className="h-3 w-3 accent-blue-500"
          />
          Velocity
        </label>
        <label className="mb-2 flex cursor-pointer items-center gap-1 text-[11px] text-foreground">
          <input
            type="checkbox"
            checked={!infoCollapsed}
            onChange={(e) => setInfoCollapsed(!e.target.checked)}
            className="h-3 w-3 accent-blue-500"
          />
          Info
        </label>
        {mapPackages.length > 1 && (
          <label className="mb-2 flex items-center gap-1 text-[11px] text-foreground">
            <span className="w-7 shrink-0 text-muted-foreground">Map</span>
            <select
              value={activeMapPackage}
              onChange={(e) => client?.setMapPackage(e.target.value)}
              className="flex-1 rounded border border-border bg-bg-alt px-1 py-0.5 text-[11px] text-foreground"
              title="Map provider package"
            >
              {mapPackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.label || pkg.id}
                  {pkg.zoneCount > 0 ? ` (${pkg.zoneCount})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mb-2 border-t border-border pt-1.5">
          <label className="mb-1 flex cursor-pointer items-center gap-1 text-[11px] text-foreground">
            <input
              type="checkbox"
              checked={heightFilter}
              onChange={(e) => {
                const on = e.target.checked;
                setHeightFilter(on);
                // Match the in-game behavior of defaulting a fresh filter to
                // 10 each way; leave non-zero values the user already set.
                if (on) {
                  if (!(heightAbove > 0)) setHeightAbove(10);
                  if (!(heightBelow > 0)) setHeightBelow(10);
                }
              }}
              className="h-3 w-3 accent-blue-500"
            />
            Height filter
          </label>
          {heightFilter && (
            <div className="flex gap-2 pl-4">
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span>Above</span>
                <input
                  type="number"
                  min={0}
                  value={heightAbove}
                  onChange={(e) => setHeightAbove(Math.max(0, Number(e.target.value)))}
                  className="w-12 rounded border border-border bg-bg-alt px-1 py-0.5 text-right tabular-nums text-foreground"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span>Below</span>
                <input
                  type="number"
                  min={0}
                  value={heightBelow}
                  onChange={(e) => setHeightBelow(Math.max(0, Number(e.target.value)))}
                  className="w-12 rounded border border-border bg-bg-alt px-1 py-0.5 text-right tabular-nums text-foreground"
                />
              </label>
            </div>
          )}
        </div>
        {availableLayers.length === 0 ? (
          <div className="text-muted-foreground">no map loaded</div>
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              {availableLayers.map((layer) => (
                <label
                  key={layer}
                  className="flex cursor-pointer items-center gap-1 text-[11px] text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={visibleLayers.has(layer)}
                    onChange={() => toggleLayer(layer)}
                    className="h-3 w-3 accent-blue-500"
                  />
                  {/* Layer 0 is the base geometry; higher layers are
                      numbered. Mirrors showeq-c's loadLayerButtons
                      labels "Base", "1", "2", … (map.cpp:5370). */}
                  {layer === 0 ? 'Base' : layer}
                </label>
              ))}
            </div>
            <div className="mt-1 flex gap-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={allOn}
                className="flex-1 rounded border border-border bg-bg-alt px-1 py-0.5 text-[10px] text-foreground hover:bg-bg-base"
              >
                all
              </button>
              <button
                type="button"
                onClick={allOff}
                className="flex-1 rounded border border-border bg-bg-alt px-1 py-0.5 text-[10px] text-foreground hover:bg-bg-base"
              >
                none
              </button>
            </div>
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// Hover tooltip — mirrors the shape of showeq-c's MapTip popup
// (map.cpp:4438-4523) but trimmed to the fields the daemon ships:
// no race string. Positioned at the cursor with a small down-right
// offset to match the showeq-c +15px nudge.
function HoverTip({
  store,
  hover,
}: {
  store: SpawnStore;
  hover: { id: number; screenX: number; screenY: number } | null;
}) {
  if (!hover) return null;
  const spawn = store.all().find((s) => s.id === hover.id);
  if (!spawn) return null;
  const isDrop = spawn.type === SpawnType.DROP;
  const baseName = spawn.name || '(unnamed)';
  const display = spawn.lastName ? `${baseName} (${spawn.lastName})` : baseName;
  // The self spawn record carries no usable HP — the daemon routes player
  // vitals through player_stats, and SpawnUpdated has no hp_max field at all.
  // Read your own HP from stats(), same as the pinned row in SpawnList.
  const isSelf = spawn.id === store.player()?.id;
  const stats = isSelf ? store.stats() : undefined;
  const hpCur = isSelf ? (stats?.hpCur ?? 0) : spawn.hpCur;
  const hpMax = isSelf ? (stats?.hpMax ?? 0) : spawn.hpMax;
  const hpPct = hpMax > 0 ? Math.round((hpCur / hpMax) * 100) : null;
  const cls = classNameOf(spawn.class);
  return (
    <div
      style={{ left: hover.screenX + 12, top: hover.screenY + 12 }}
      className="pointer-events-none absolute z-10 max-w-[220px] rounded border border-border bg-bg-panel/95 px-2 py-1 text-[11px] text-foreground shadow-md backdrop-blur"
    >
      <div className="truncate font-medium">{display}</div>
      {/* Drops are ground loot — no level/HP/class to show, so trim that
          line and leave just the name + coords. */}
      {!isDrop && (
        <div className="text-muted-foreground">
          L{spawn.level || '?'}
          {hpPct != null ? ` · ${hpPct}% HP` : ''}
          {cls ? ` · ${cls}` : ''}
        </div>
      )}
      {/* Guild tag, showeq-c's MapTip carried one too. Empty for unguilded
          spawns and for guilds the daemon hasn't seen named on the wire yet. */}
      {spawn.guildTag && (
        <div className="truncate text-muted-foreground">&lt;{spawn.guildTag}&gt;</div>
      )}
      <div className="tabular-nums text-muted-foreground">
        {/* Show coords in EQ /loc convention (Y, X, Z) so they match the
            status bar and the in-game /loc — see lib/coords. The raw
            pos.x/pos.y are screen convention (negated). */}
        {formatLoc(spawn.pos?.x ?? 0, spawn.pos?.y ?? 0, spawn.pos?.z ?? 0)}
      </div>
    </div>
  );
}
