// Backfill loot from an offline .pbstream capture (daemon FileSink format:
// repeating 4-byte little-endian length + serialized seq.v1.Envelope). Feeds the
// same recorder core as the live host, into the per-backend DB named by the
// capture's own Snapshot.data_namespace (~/.scry/loot.db for Live,
// ~/.scry/eql/loot.db for EQL) unless --db overrides. Also the fast,
// deterministic re-test path for the pipeline.
//
//   bun scripts/loot-backfill.ts <file.pbstream> [--db PATH]
import { fromBinary } from '@bufbuild/protobuf';
import { EnvelopeSchema } from '../src/gen/seq/v1/events_pb';
import { LootRecorderCore } from '../src/recorder/core';
import { BunSqliteSink } from './bun-sink';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('usage: bun scripts/loot-backfill.ts <file.pbstream> [--db PATH]');
  process.exit(1);
}
const dbIdx = process.argv.indexOf('--db');
const explicitDb = dbIdx >= 0 ? process.argv[dbIdx + 1] : undefined;

const buf = readFileSync(file);

// Iterate the length-delimited Envelope records, calling `fn` on each.
function eachEnvelope(fn: (env: ReturnType<typeof fromBinary<typeof EnvelopeSchema>>) => boolean | void): void {
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt32LE(off);
    off += 4;
    if (len === 0 || off + len > buf.length) break;
    try {
      if (fn(fromBinary(EnvelopeSchema, buf.subarray(off, off + len))) === true) return;
    } catch {
      // skip a malformed record
    }
    off += len;
  }
}

// Pass 1: the DB namespace from the first Snapshot (stop there).
let namespace = '.scry';
eachEnvelope((e) => {
  if (e.payload.case === 'snapshot') {
    if (e.payload.value.dataNamespace) namespace = e.payload.value.dataNamespace;
    return true;
  }
});

const dbPath = explicitDb ?? join(homedir(), namespace, 'loot.db');
mkdirSync(dirname(dbPath), { recursive: true });
const sink = new BunSqliteSink(dbPath);
const core = new LootRecorderCore(sink);

// Pass 2: decode + apply.
let envs = 0;
eachEnvelope((e) => { core.applyEnvelope(e); envs++; });
core.flush();

console.log(`ingested ${envs} envelopes → ${core.count()} loot rows → ${dbPath}`);
sink.close();
