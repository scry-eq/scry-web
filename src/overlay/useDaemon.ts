// A minimal live read of the daemon for the overlay window. Deliberately NOT the main
// window's SpawnStore: the overlay shows four numbers, and pulling the full store in would
// make a 200x340 panel carry the whole app's state graph.
import { useEffect, useRef, useState } from 'react';
import { SeqClient } from '../net/client';
import { daemonUrl } from '../net/daemonUrl';

export type Vitals = {
  status: 'open' | 'connecting' | 'closed';
  zone: string;
  spawns: number;
  level: number;
  hpCur: number;
  hpMax: number;
  manaCur: number;
  manaMax: number;
};

const EMPTY: Vitals = {
  status: 'connecting',
  zone: '',
  spawns: 0,
  level: 0,
  hpCur: 0,
  hpMax: 0,
  manaCur: 0,
  manaMax: 0,
};

export function useDaemon(): Vitals {
  const [vitals, setVitals] = useState<Vitals>(EMPTY);
  const spawns = useRef(new Set<number>());

  useEffect(() => {
    const client = new SeqClient(daemonUrl());
    const detach = client.onEnvelope((env) => {
      const p = env.payload;
      switch (p.case) {
        case 'snapshot':
          spawns.current = new Set(p.value.spawns.map((s) => s.id));
          setVitals((v) => ({
            ...v,
            zone: p.value.zoneLong || p.value.zoneShort,
            spawns: spawns.current.size,
          }));
          break;
        case 'zoneChanged':
          // A zone change invalidates every spawn id; the daemon replays them.
          spawns.current = new Set();
          setVitals((v) => ({
            ...v,
            zone: p.value.zoneLong || p.value.zoneShort,
            spawns: 0,
          }));
          break;
        case 'spawnAdded':
          if (p.value.spawn) spawns.current.add(p.value.spawn.id);
          setVitals((v) => ({ ...v, spawns: spawns.current.size }));
          break;
        case 'spawnRemoved':
          spawns.current.delete(p.value.id);
          setVitals((v) => ({ ...v, spawns: spawns.current.size }));
          break;
        case 'playerStats':
          setVitals((v) => ({
            ...v,
            level: p.value.level,
            hpCur: p.value.hpCur,
            hpMax: p.value.hpMax,
            manaCur: p.value.manaCur,
            manaMax: p.value.manaMax,
          }));
          break;
      }
    });
    client.connect();

    // SeqClient reports state on demand rather than pushing it; 1 Hz is enough for a dot.
    const poll = setInterval(
      () => setVitals((v) => (v.status === client.state() ? v : { ...v, status: client.state() })),
      1000,
    );

    return () => {
      clearInterval(poll);
      detach();
      client.close();
    };
  }, []);

  return vitals;
}
