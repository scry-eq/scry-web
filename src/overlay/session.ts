// A live daemon session for an overlay window: the same SeqClient the main window opens,
// plus a SpawnStore for the panels that need the whole world rather than four numbers.
//
// Each overlay window is its own page and therefore its own client. That is deliberate: an
// overlay must keep working when the main window is closed, and the daemon fans out to every
// subscriber anyway.
import { useEffect, useRef, useState } from 'react';
import { SeqClient } from '../net/client';
import { daemonUrl } from '../net/daemonUrl';
import { SpawnStore } from '../state/store';

export type Session = {
  store: SpawnStore;
  client: SeqClient | null;
  /** Bumped on a timer; the canvas and panels re-read the store off it. */
  tick: number;
};

export function useSession(): Session {
  const storeRef = useRef<SpawnStore | null>(null);
  if (!storeRef.current) storeRef.current = new SpawnStore();
  const [client, setClient] = useState<SeqClient | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const store = storeRef.current!;
    const c = new SeqClient(daemonUrl());
    const detach = c.onEnvelope((env) => store.apply(env));
    c.connect();
    setClient(c);
    // 1 Hz, matching the main window: the store mutates continuously, and this is what
    // turns it into renders.
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(id);
      detach();
      c.close();
      setClient(null);
    };
  }, []);

  return { store: storeRef.current, client, tick };
}
