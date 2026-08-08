// Diagnostic script: connect to the daemon and analyse spawn movement patterns.
// Run with: ~/.bun/bin/bun run scripts/diag-movement.ts [ws://host:port]
// (from the repo root; system Node breaks the bun-only imports).

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { EnvelopeSchema } from '../src/gen/seq/v1/events_pb';
import { ClientEnvelopeSchema, SubscribeSchema, Topic } from '../src/gen/seq/v1/client_pb';

// Pass the daemon URL when it isn't on this box.
const WS_URL = process.argv[2] || 'ws://127.0.0.1:9090';
const RUN_DURATION_MS = 60_000;

// -------------------------------------------------------------------
// Tracking state
// -------------------------------------------------------------------

interface SpawnPos {
  x: number;
  y: number;
  z: number;
}

interface SpawnState {
  id: number;
  name: string;
  lastPos: SpawnPos;
  lastUpdateMs: number;
  updateCount: number;
  dtSamples: number[];   // inter-update intervals
  distSamples: number[]; // distance moved per update
}

const spawnStates = new Map<number, SpawnState>();
let playerId = 0;
let totalPosUpdates = 0;

// Distance buckets: <5, 5-30, 30-150, >150
const buckets = [0, 0, 0, 0];
const largejumps: { id: number; name: string; dist: number; dt: number; smoother: number }[] = [];

function bucketFor(dist: number): number {
  if (dist < 5) return 0;
  if (dist < 30) return 1;
  if (dist < 150) return 2;
  return 3;
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

console.log(`Connecting to ${WS_URL} ...`);

const ws = new WebSocket(WS_URL);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
  console.log('Connected. Sending Subscribe (SPAWNS + ZONE + PLAYER) ...');
  const env = create(ClientEnvelopeSchema, {
    payload: {
      case: 'subscribe',
      value: create(SubscribeSchema, {
        topics: [Topic.SPAWNS, Topic.ZONE, Topic.PLAYER],
        // no sessionId / lastSeq — fresh session
      }),
    },
  });
  ws.send(toBinary(ClientEnvelopeSchema, env));
  console.log(`Collecting data for ${RUN_DURATION_MS / 1000}s ...\n`);
};

ws.onmessage = (ev: MessageEvent) => {
  if (!(ev.data instanceof ArrayBuffer)) return;
  const bytes = new Uint8Array(ev.data);
  let env;
  try {
    env = fromBinary(EnvelopeSchema, bytes);
  } catch (e) {
    console.warn('decode error', e);
    return;
  }

  const p = env.payload;

  if (p.case === 'snapshot') {
    const snap = p.value;
    playerId = snap.playerId;
    spawnStates.clear();
    const nowMs = Date.now();
    for (const spawn of snap.spawns) {
      if (!spawn.pos) continue;
      spawnStates.set(spawn.id, {
        id: spawn.id,
        name: spawn.name,
        lastPos: { x: spawn.pos.x, y: spawn.pos.y, z: spawn.pos.z },
        lastUpdateMs: nowMs,
        updateCount: 0,
        dtSamples: [],
        distSamples: [],
      });
    }
    console.log(`Snapshot: zone=${snap.zoneShort}, spawns=${snap.spawns.length}, player_id=${playerId}`);
    return;
  }

  if (p.case === 'spawnAdded') {
    const spawn = p.value.spawn;
    if (!spawn || !spawn.pos) return;
    if (!spawnStates.has(spawn.id)) {
      spawnStates.set(spawn.id, {
        id: spawn.id,
        name: spawn.name,
        lastPos: { x: spawn.pos.x, y: spawn.pos.y, z: spawn.pos.z },
        lastUpdateMs: Date.now(),
        updateCount: 0,
        dtSamples: [],
        distSamples: [],
      });
    }
    return;
  }

  if (p.case === 'spawnUpdated') {
    const u = p.value;
    if (!u.pos) return; // no position update in this delta

    const nowMs = Date.now();
    totalPosUpdates++;

    let state = spawnStates.get(u.id);
    if (!state) {
      // Spawn added after snapshot, no baseline — seed it now
      state = {
        id: u.id,
        name: String(u.id),
        lastPos: { x: u.pos.x, y: u.pos.y, z: u.pos.z },
        lastUpdateMs: nowMs,
        updateCount: 0,
        dtSamples: [],
        distSamples: [],
      };
      spawnStates.set(u.id, state);
      return;
    }

    const dx = u.pos.x - state.lastPos.x;
    const dy = u.pos.y - state.lastPos.y;
    const dist = Math.hypot(dx, dy);
    const dt = nowMs - state.lastUpdateMs;
    const smootherDuration = Math.min(300, Math.max(50, dt));

    state.lastPos = { x: u.pos.x, y: u.pos.y, z: u.pos.z };
    state.lastUpdateMs = nowMs;
    state.updateCount++;
    state.dtSamples.push(dt);
    state.distSamples.push(dist);

    buckets[bucketFor(dist)]++;

    if (dist > 30) {
      const entry = {
        id: u.id,
        name: state.name || String(u.id),
        dist,
        dt,
        smoother: smootherDuration,
      };
      largejumps.push(entry);
      if (dist > 150) {
        console.log(`!! LARGE JUMP  id=${u.id} name="${state.name}" dist=${dist.toFixed(1)} dt=${dt}ms smoother=${smootherDuration}ms`);
      } else {
        console.log(`   medium jump id=${u.id} name="${state.name}" dist=${dist.toFixed(1)} dt=${dt}ms smoother=${smootherDuration}ms`);
      }
    }

    return;
  }

  if (p.case === 'spawnRemoved' || p.case === 'spawnKilled') {
    const id = p.case === 'spawnRemoved' ? p.value.id : p.value.deceasedId;
    spawnStates.delete(id);
  }
};

ws.onerror = (e) => {
  console.error('WebSocket error', e);
};

ws.onclose = () => {
  console.log('WebSocket closed');
};

// -------------------------------------------------------------------
// Print summary after RUN_DURATION_MS
// -------------------------------------------------------------------

setTimeout(() => {
  ws.close();

  console.log('\n=============================================================');
  console.log('               MOVEMENT DIAGNOSTIC SUMMARY');
  console.log('=============================================================\n');

  console.log(`Total position updates received: ${totalPosUpdates}`);
  console.log(`Active tracked spawns at end:    ${spawnStates.size}`);
  console.log();

  // Distribution
  const total = buckets.reduce((a, b) => a + b, 0);
  console.log('Distance distribution:');
  console.log(`  <5 EQ    : ${buckets[0].toString().padStart(5)} (${pct(buckets[0], total)})`);
  console.log(`  5-30 EQ  : ${buckets[1].toString().padStart(5)} (${pct(buckets[1], total)})`);
  console.log(`  30-150 EQ: ${buckets[2].toString().padStart(5)} (${pct(buckets[2], total)})`);
  console.log(`  >150 EQ  : ${buckets[3].toString().padStart(5)} (${pct(buckets[3], total)}) <-- teleport-class`);
  console.log();

  // Global dt stats across all spawns
  const allDts: number[] = [];
  for (const s of spawnStates.values()) allDts.push(...s.dtSamples);
  if (allDts.length > 0) {
    const avgDt = allDts.reduce((a, b) => a + b, 0) / allDts.length;
    const maxDt = Math.max(...allDts);
    const minDt = Math.min(...allDts);
    const p50 = percentile(allDts, 50);
    const p95 = percentile(allDts, 95);
    console.log('Inter-update interval (dt) across all spawn updates:');
    console.log(`  min   : ${minDt}ms`);
    console.log(`  avg   : ${avgDt.toFixed(1)}ms`);
    console.log(`  p50   : ${p50}ms`);
    console.log(`  p95   : ${p95}ms`);
    console.log(`  max   : ${maxDt}ms`);
    console.log();
  } else {
    console.log('(no dt samples — no position updates received)\n');
  }

  // Top 10 most-updated spawns
  const ranked = Array.from(spawnStates.values())
    .filter(s => s.updateCount > 0)
    .sort((a, b) => b.updateCount - a.updateCount)
    .slice(0, 10);

  console.log('Top 10 most-updated spawns:');
  console.log('  ' + 'id'.padEnd(8) + 'name'.padEnd(24) + 'updates'.padEnd(10) + 'avg_dt'.padEnd(10) + 'avg_dist');
  for (const s of ranked) {
    const avgDt = s.dtSamples.length
      ? (s.dtSamples.reduce((a, b) => a + b, 0) / s.dtSamples.length).toFixed(0)
      : '-';
    const avgDist = s.distSamples.length
      ? (s.distSamples.reduce((a, b) => a + b, 0) / s.distSamples.length).toFixed(2)
      : '-';
    const marker = s.id === playerId ? ' <-- PLAYER' : '';
    console.log(
      '  ' +
      String(s.id).padEnd(8) +
      s.name.slice(0, 22).padEnd(24) +
      String(s.updateCount).padEnd(10) +
      (avgDt + 'ms').padEnd(10) +
      avgDist + marker,
    );
  }
  console.log();

  // Player-specific stats
  const playerState = spawnStates.get(playerId);
  console.log('--- Player stats ---');
  if (!playerState) {
    console.log(`  player_id=${playerId} — no state found (not yet zoned in?)`);
  } else {
    console.log(`  player_id : ${playerId}`);
    console.log(`  name      : ${playerState.name}`);
    console.log(`  updates   : ${playerState.updateCount}`);
    if (playerState.dtSamples.length > 0) {
      const avgDt = playerState.dtSamples.reduce((a, b) => a + b, 0) / playerState.dtSamples.length;
      const maxDt = Math.max(...playerState.dtSamples);
      const minDt = Math.min(...playerState.dtSamples);
      const p50 = percentile(playerState.dtSamples, 50);
      const p95 = percentile(playerState.dtSamples, 95);
      console.log(`  dt min    : ${minDt}ms`);
      console.log(`  dt avg    : ${avgDt.toFixed(1)}ms`);
      console.log(`  dt p50    : ${p50}ms`);
      console.log(`  dt p95    : ${p95}ms`);
      console.log(`  dt max    : ${maxDt}ms`);
      const avgDist = playerState.distSamples.reduce((a, b) => a + b, 0) / playerState.distSamples.length;
      const maxDist = Math.max(...playerState.distSamples);
      console.log(`  avg dist  : ${avgDist.toFixed(2)} EQ`);
      console.log(`  max dist  : ${maxDist.toFixed(2)} EQ`);
    } else {
      console.log('  (no position updates — player may be stationary)');
    }
  }
  console.log();

  // Large jumps summary
  const bigJumps = largejumps.filter(j => j.dist > 150);
  const medJumps = largejumps.filter(j => j.dist >= 30 && j.dist <= 150);
  console.log('--- Large / medium jump summary ---');
  console.log(`  >150 EQ (teleport-class) : ${bigJumps.length}`);
  console.log(`  30-150 EQ (lerp-but-ugly): ${medJumps.length}`);
  if (bigJumps.length > 0) {
    console.log('\n  Teleport-class individual entries:');
    for (const j of bigJumps.slice(0, 20)) {
      console.log(`    !! id=${j.id} "${j.name}" dist=${j.dist.toFixed(1)} dt=${j.dt}ms smoother=${j.smoother}ms`);
    }
  }

  console.log('\n=============================================================\n');

  process.exit(0);
}, RUN_DURATION_MS);

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function pct(n: number, total: number): string {
  if (total === 0) return '  0%';
  return (n / total * 100).toFixed(1).padStart(5) + '%';
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
