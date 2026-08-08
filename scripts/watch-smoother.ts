/**
 * Diagnostic script: watch PosSmoother live state via headless Chromium.
 * Walks the React fiber to find the smoother's positions Map and streams
 * every position change with timing so we can see actual update intervals,
 * delta sizes, and durationMs choices.
 *
 * Usage:  bun run scripts/watch-smoother.ts [url]
 * Default url: http://127.0.0.1:5173 — pass the LAN URL when the dev server
 * isn't on this box.
 *
 * Keep it running for 60 s or so while moving your character; Ctrl-C to stop.
 */

import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5173';
const POLL_MS = 80;       // how often we read the smoother from Node side
const REPORT_SECS = 5;    // summary every N seconds

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Suppress console noise from the app itself.
page.on('console', () => {});
page.on('pageerror', () => {});

console.log(`Connecting to ${URL} …`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 20_000 });
console.log('Page loaded. Watching smoother (Ctrl-C to stop).\n');

// Inject the fiber-walker + collector into the page once.
// It writes deltas into window.__smootherLog (capped ring buffer).
await page.evaluate(() => {
  (window as any).__smootherLog = [];

  // React tags the ROOT CONTAINER with __reactContainer$… and every rendered
  // ELEMENT with __reactFiber$…. #root is a container, so searching it for
  // __reactFiber$ alone finds nothing and the whole walk silently yields null.
  // Accept either key, and normalize: a Fiber has a numeric .tag, while a
  // FiberRootNode wraps the fiber in .current.
  function fiberFromNode(node: Element | null): any {
    if (!node) return null;
    const key = Object.keys(node).find(
      k => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
    );
    if (!key) return null;
    const val = (node as any)[key];
    return typeof val?.tag === 'number' ? val : (val?.current ?? val);
  }

  // The smoother is a useRef whose .current holds the positions Map.
  function smootherIn(fiber: any): any {
    let state = fiber?.memoizedState;
    while (state) {
      const val = state.memoizedState;
      if (val && typeof val === 'object' && val.current &&
          val.current.positions instanceof Map) {
        const first = val.current.positions.values().next().value;
        if (first && 'targetX' in first) return val.current;
      }
      state = state.next;
    }
    return null;
  }

  function findSmoother(): any {
    // 1. Walk the whole tree down from the root container.
    let found: any = null;
    (function walk(fiber: any) {
      if (!fiber || found) return;
      found = smootherIn(fiber);
      if (found) return;
      walk(fiber.child);
      walk(fiber.sibling);
    })(fiberFromNode(document.getElementById('root')));
    if (found) return found;

    // 2. Fallback: up the .return chain from the canvas. MapCanvas owns the
    //    ref and is an ANCESTOR of the canvas element, so a downward walk
    //    from there would miss it.
    let fiber = fiberFromNode(document.querySelector('canvas'));
    while (fiber) {
      const sm = smootherIn(fiber);
      if (sm) return sm;
      fiber = fiber.return;
    }
    return null;
  }

  // prev snapshot: id → { x, y, seenAt }
  const prev = new Map<number, { x: number; y: number; seenAt: number }>();

  setInterval(() => {
    const sm = findSmoother();
    if (!sm) return;
    const now = performance.now();

    for (const [id, pos] of sm.positions as Map<number, any>) {
      const p = prev.get(id);
      if (!p) {
        prev.set(id, { x: pos.targetX, y: pos.targetY, seenAt: now });
        continue;
      }
      if (pos.targetX !== p.x || pos.targetY !== p.y) {
        const dist = Math.hypot(pos.targetX - p.x, pos.targetY - p.y);
        const dt = now - p.seenAt;
        const log: any[] = (window as any).__smootherLog;
        // SmoothedPos carries intervalMs (the interpolation window); an older
        // durationMs field no longer exists and read as undefined every line.
        log.push({ id, dist, dt, interval: pos.intervalMs, x: pos.targetX, y: pos.targetY });
        if (log.length > 2000) log.splice(0, 500);
        prev.set(id, { x: pos.targetX, y: pos.targetY, seenAt: now });
      }
    }
    // Clean up gone spawns.
    for (const id of prev.keys()) {
      if (!sm.positions.has(id)) prev.delete(id);
    }
  }, 40);
});

// Node side: drain the log periodically and print deltas.
let lastSummary = Date.now();
let totalUpdates = 0;
const distBuckets = { small: 0, medium: 0, large: 0, teleport: 0 };
const dtSamples: number[] = [];

const drain = async () => {
  const entries: any[] = await page.evaluate(() => {
    const log = (window as any).__smootherLog ?? [];
    (window as any).__smootherLog = [];
    return log;
  });

  for (const e of entries) {
    totalUpdates++;
    dtSamples.push(e.dt);
    if (e.dist < 5)        distBuckets.small++;
    else if (e.dist < 30)  distBuckets.medium++;
    else if (e.dist < 150) distBuckets.large++;
    else                   distBuckets.teleport++;

    const flag = e.dist >= 150 ? ' *** SNAP ***' : e.dist >= 30 ? ' !! large' : '';
    console.log(
      `id=${String(e.id).padStart(5)}  dist=${String(e.dist.toFixed(1)).padStart(7)}  ` +
      `dt=${String(e.dt.toFixed(0)).padStart(5)}ms  ` +
      `int=${String(e.interval != null ? Math.round(e.interval) : '?').padStart(4)}ms${flag}`
    );
  }

  // Periodic summary.
  const now = Date.now();
  if (now - lastSummary >= REPORT_SECS * 1000 && totalUpdates > 0) {
    lastSummary = now;
    const avgDt = dtSamples.length
      ? (dtSamples.reduce((a, b) => a + b, 0) / dtSamples.length).toFixed(0)
      : '?';
    const maxDt = dtSamples.length ? Math.max(...dtSamples).toFixed(0) : '?';
    dtSamples.length = 0;
    console.log(
      `\n── ${REPORT_SECS}s summary ──  total=${totalUpdates}  ` +
      `avgDt=${avgDt}ms  maxDt=${maxDt}ms  ` +
      `dist: small(<5)=${distBuckets.small} mid(5-30)=${distBuckets.medium} ` +
      `large(30-150)=${distBuckets.large} snap(≥150)=${distBuckets.teleport}\n`
    );
  }
};

// Poll loop.
const interval = setInterval(drain, POLL_MS);

process.on('SIGINT', async () => {
  clearInterval(interval);
  await drain();
  console.log('\nDone.');
  await browser.close();
  process.exit(0);
});

// Keep alive.
await new Promise(() => {});
