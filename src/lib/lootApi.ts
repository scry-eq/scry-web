// Loot history access. The host (showeq-daemon or scry) records what it decodes
// and answers a LootQuery on its /loot websocket path, so there is no separate
// recorder process to run, no second port to discover, and nothing to configure:
// the loot socket is derived from whichever daemon URL the app is already on.
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { EnvelopeSchema, type LootRecord } from '@gen/seq/v1/events_pb';
import { ClientEnvelopeSchema, LootQuerySchema } from '@gen/seq/v1/client_pb';

export type { LootRecord };

// How long to wait for the LootPage before giving up. The host answers from a
// local SQLite read, so this only trips when it is unreachable or wedged.
const QUERY_TIMEOUT_MS = 10_000;

// ws://host:port -> ws://host:port/loot, preserving wss:// on an https page.
export function lootSocketUrl(daemonWsUrl: string): string {
  try {
    const u = new URL(daemonWsUrl);
    u.pathname = '/loot';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return 'ws://localhost:9090/loot';
  }
}

export async function fetchLoot(daemonWsUrl: string, limit = 5000): Promise<LootRecord[]> {
  const url = lootSocketUrl(daemonWsUrl);
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    ws.binaryType = 'arraybuffer';

    const done = (fn: () => void) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new Error(`no LootPage within ${QUERY_TIMEOUT_MS}ms`))),
      QUERY_TIMEOUT_MS,
    );

    ws.onopen = () => {
      const q = create(ClientEnvelopeSchema, {
        payload: { case: 'lootQuery', value: create(LootQuerySchema, { limit }) },
      });
      ws.send(toBinary(ClientEnvelopeSchema, q));
    };

    ws.onmessage = (ev) => {
      try {
        const env = fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer));
        if (env.payload.case !== 'lootPage') return;   // ignore anything else
        const { rows } = env.payload.value;
        done(() => resolve(rows));
      } catch (e) {
        done(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    };

    // The browser withholds the reason for a failed socket, so name the URL —
    // otherwise "loot unavailable" gives the user nothing to check.
    ws.onerror = () => done(() => reject(new Error(`cannot reach ${url}`)));
    ws.onclose = () => done(() => reject(new Error(`${url} closed before answering`)));
  });
}

// copper -> "4p 6g 4s 3c", suppressing zero denominations.
export function formatCoin(copper: number): string {
  if (!copper) return '0c';
  const parts: string[] = [];
  const p = Math.floor(copper / 1000);
  const g = Math.floor(copper / 100) % 10;
  const s = Math.floor(copper / 10) % 10;
  const c = copper % 10;
  if (p) parts.push(`${p.toLocaleString()}p`);
  if (g) parts.push(`${g}g`);
  if (s) parts.push(`${s}s`);
  if (c) parts.push(`${c}c`);
  return parts.join(' ');
}
