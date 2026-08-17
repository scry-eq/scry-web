// The map, as a floating overlay. Same MapCanvas the main window renders — it takes a store
// and a client, so an overlay window that owns both can mount it unchanged.
import { useCallback, useEffect, useState } from 'react';
import { MapCanvas } from '../ui/MapCanvas';
import { usePrefsStore } from '../state/prefsStore';
import { selectFromPacket } from '../state/selectFromPackets';
import type { Session } from './session';

export function MapOverlay({ session }: { session: Session }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectVersion, setSelectVersion] = useState(0);
  const prefs = usePrefsStore();

  const onSelect = useCallback((id: number | null) => {
    setSelectedId(id);
    setSelectVersion((v) => v + 1);
  }, []);

  // Same select-on-target / select-on-consider behaviour as the main window: this is the
  // same map, and a view that ignored those toggles would just be a different app.
  useEffect(() => {
    const client = session.client;
    if (!client) return;
    return client.onEnvelope((env) => selectFromPacket(env, onSelect));
  }, [session.client, onSelect]);

  return (
    <MapCanvas
      store={session.store}
      client={session.client}
      tick={session.tick}
      selectedId={selectedId}
      selectVersion={selectVersion}
      onSelect={onSelect}
      // The overlay follows the same movement preferences as the main window — they are
      // localStorage-backed, so both pages read the one setting.
      trackPlayer={prefs.trackPlayer}
      smoothMovement={prefs.smoothMovement}
      predictiveMovement={prefs.predictiveMovement}
      compact
    />
  );
}
