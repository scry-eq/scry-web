import type { Page } from '@playwright/test';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  EnvelopeSchema,
  LootPageSchema,
  MapGeometrySchema,
  MapLineSchema,
  SnapshotSchema,
  SpawnPointSchema,
  SpawnSchema,
} from '../../src/gen/seq/v1/events_pb';
import { ClientEnvelopeSchema } from '../../src/gen/seq/v1/client_pb';

// A stand-in daemon for the e2e suite: real seq.v1 frames over a mocked
// WebSocket, so the app's decode → store → render path runs exactly as it
// does against scryd. Fixtures live here so specs share one world.

export const SPAWNS = [
  { id: 1, name: 'Miragul', level: 55, class: 12, hpCur: 30, hpMax: 100, x: 120, y: -60 },
  { id: 2, name: 'a bat', level: 3, class: 1, hpCur: 100, hpMax: 100, x: -200, y: 150 },
  { id: 3, name: 'Zordak', level: 41, class: 9, hpCur: 70, hpMax: 100, x: 40, y: 240 },
  { id: 4, name: 'Cazic Thule', level: 70, class: 1, hpCur: 55, hpMax: 100, x: -90, y: -180 },
];

export const PLAYER = { id: 99, name: 'Testchar', level: 50, class: 1, hpCur: 80, hpMax: 100, x: 0, y: 0 };

export const POINTS = [
  { key: 'sp-c', name: 'orc pawn', x: 30, y: 30, z: 0, count: 7 },
  { key: 'sp-a', name: 'a griffon', x: 10, y: 10, z: 0, count: 21 },
  { key: 'sp-b', name: 'Vox', x: 20, y: 20, z: 0, count: 2 },
];

export const LOOT = [
  { ts: 300n, itemName: 'Rusty Dagger', itemId: 11, qty: 3, mobName: 'a bat', zoneBase: 'qeynos' },
  { ts: 100n, itemName: 'Abacus', itemId: 33, qty: 5, mobName: 'Zordak', zoneBase: 'freeport' },
  { ts: 200n, itemName: 'Mithril Bar', itemId: 22, qty: 2, mobName: 'Vox', zoneBase: 'permafrost' },
];

// A box with a diagonal through it — enough strokes that the map has
// something to draw, and asymmetric so a pan or zoom visibly changes it.
function geometry() {
  const line = (color: string, x: number[], y: number[]) =>
    create(MapLineSchema, { color, x, y, z: x.map(() => 0), layer: 0 });
  return create(MapGeometrySchema, {
    minX: -400,
    minY: -400,
    maxX: 400,
    maxY: 400,
    lines: [
      line('#808080', [-300, 300, 300, -300, -300], [-300, -300, 300, 300, -300]),
      line('#00a0ff', [-300, 300], [-300, 300]),
      line('#ff8000', [-150, 150, 0, -150], [200, 200, -100, 200]),
    ],
  });
}

export type DaemonOptions = {
  /** Include a player spawn + player_id, so the map can centre on it. */
  withPlayer?: boolean;
  /** Include zone map geometry. */
  withGeometry?: boolean;
};

function snapshotFrame(opts: DaemonOptions): Uint8Array {
  const spawns = SPAWNS.map((s) =>
    create(SpawnSchema, {
      id: s.id,
      name: s.name,
      level: s.level,
      class: s.class,
      hpCur: s.hpCur,
      hpMax: s.hpMax,
      type: 1,
      pos: { x: s.x, y: s.y, z: 0 },
    }),
  );
  if (opts.withPlayer) {
    spawns.push(
      create(SpawnSchema, {
        id: PLAYER.id,
        name: PLAYER.name,
        level: PLAYER.level,
        class: PLAYER.class,
        hpCur: PLAYER.hpCur,
        hpMax: PLAYER.hpMax,
        type: 1,
        pos: { x: PLAYER.x, y: PLAYER.y, z: 0 },
      }),
    );
  }
  return toBinary(
    EnvelopeSchema,
    create(EnvelopeSchema, {
      seq: 1n,
      payload: {
        case: 'snapshot',
        value: create(SnapshotSchema, {
          sessionId: 'e2e',
          zoneShort: 'qeynos',
          zoneLong: 'South Qeynos',
          playerId: opts.withPlayer ? PLAYER.id : 0,
          spawns,
          spawnPoints: POINTS.map((p) => create(SpawnPointSchema, p)),
          geometry: opts.withGeometry ? geometry() : undefined,
        }),
      },
    }),
  );
}

function lootFrame(): Uint8Array {
  return toBinary(
    EnvelopeSchema,
    create(EnvelopeSchema, {
      seq: 2n,
      payload: { case: 'lootPage', value: create(LootPageSchema, { rows: LOOT }) },
    }),
  );
}

/**
 * Answer both daemon sockets: the main stream replies to Subscribe with a
 * Snapshot, and /loot replies to a LootQuery with a LootPage.
 */
export async function mockDaemon(page: Page, opts: DaemonOptions = {}) {
  await page.routeWebSocket(/localhost:9090/, (ws) => {
    const isLoot = new URL(ws.url()).pathname === '/loot';
    ws.onMessage((msg) => {
      const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : new Uint8Array(msg);
      const kind = fromBinary(ClientEnvelopeSchema, bytes).payload.case;
      if (!isLoot && kind === 'subscribe') ws.send(Buffer.from(snapshotFrame(opts)));
      if (isLoot && kind === 'lootQuery') ws.send(Buffer.from(lootFrame()));
    });
  });
}

/**
 * Tally every ctx.stroke() by colour, before the app loads.
 *
 * Reading pixels cannot prove a line was drawn: a 1px antialiased diagonal
 * blends with the background, so almost no pixel holds the pure stroke
 * colour (measured: 92 strokes of #00a0ff per frame produced 24 matching
 * pixels even at a tolerance of 80). Recording the draw calls is exact.
 */
export async function instrumentStrokes(page: Page) {
  await page.addInitScript(() => {
    const tally: Record<string, number> = {};
    (window as unknown as { __strokes: Record<string, number> }).__strokes = tally;
    const proto = CanvasRenderingContext2D.prototype;
    const orig = proto.stroke;
    proto.stroke = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const s = String(this.strokeStyle);
      tally[s] = (tally[s] ?? 0) + 1;
      return (orig as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.stroke;
  });
}

export async function strokeTally(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => (window as unknown as { __strokes: Record<string, number> }).__strokes ?? {});
}

/** Colours the fixture geometry is drawn in — MapCanvas strokes line.color verbatim. */
export const GEOMETRY_COLOURS = ['#00a0ff', '#ff8000'];
