// Watch the PLAYER heading over the live WS stream (what the map actually gets).
import { fromBinary, toBinary, create } from '@bufbuild/protobuf';
import { EnvelopeSchema } from '../src/gen/seq/v1/events_pb';
import { ClientEnvelopeSchema, SubscribeSchema, Topic } from '../src/gen/seq/v1/client_pb';

const WS_URL = process.argv[2] || 'ws://127.0.0.1:9090';
const ws = new WebSocket(WS_URL);
ws.binaryType = 'arraybuffer';
let playerId = 0;
let n = 0;
const seq: any[] = [];

ws.onopen = () => {
  const env = create(ClientEnvelopeSchema, {
    payload: { case: 'subscribe', value: create(SubscribeSchema, { topics: [Topic.SPAWNS, Topic.ZONE, Topic.PLAYER] }) },
  });
  ws.send(toBinary(ClientEnvelopeSchema, env));
  console.log('subscribed to', WS_URL);
};

ws.onmessage = (ev: MessageEvent) => {
  if (!(ev.data instanceof ArrayBuffer)) return;
  let env; try { env = fromBinary(EnvelopeSchema, new Uint8Array(ev.data)); } catch { return; }
  const p = env.payload;
  if (p.case === 'snapshot') {
    playerId = p.value.playerId;
    const self = p.value.spawns.find((s: any) => s.id === playerId);
    console.log(`snapshot: player_id=${playerId} spawns=${p.value.spawns.length} selfHeading=${self?.pos?.heading}`);
  } else if (p.case === 'spawnUpdated' && p.value.id === playerId) {
    const pos = p.value.pos;
    seq.push({ n: n++, x: pos?.x, y: pos?.y, hdg: pos?.heading, hasPos: !!pos });
  } else if (p.case === 'playerStats') {
    // ignore
  }
};

setTimeout(() => {
  ws.close();
  console.log(`\nPLAYER (id=${playerId}) update stream — ${seq.length} spawn_updated events:`);
  // print the heading sequence, flag no-pos updates and jumps
  let prev: any = null;
  for (const s of seq) {
    let flag = '';
    if (!s.hasPos) flag = '  <-- NO POS (heading-only?)';
    else if (prev && prev.hdg != null && s.hdg != null) {
      let d = Math.abs(s.hdg - prev.hdg); if (d > 180) d = 360 - d;
      if (d > 30) flag = `  <-- HEADING JUMP ${prev.hdg}->${s.hdg} (${d}°)`;
    }
    console.log(`  ${String(s.n).padStart(3)}: x=${s.x} y=${s.y} hdg=${s.hdg}${flag}`);
    prev = s;
  }
  process.exit(0);
}, 30_000);
