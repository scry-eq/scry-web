// The map, as a floating overlay. Same MapCanvas the main window renders — it takes a store
// and a client, so an overlay window that owns both can mount it unchanged.
import { useState } from 'react';
import { MapCanvas } from '../ui/MapCanvas';
import { usePrefsStore } from '../state/prefsStore';
import type { Session } from './session';

export function MapOverlay({ session }: { session: Session }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectVersion, setSelectVersion] = useState(0);
  const prefs = usePrefsStore();

  return (
    <MapCanvas
      store={session.store}
      client={session.client}
      tick={session.tick}
      selectedId={selectedId}
      selectVersion={selectVersion}
      onSelect={(id) => {
        setSelectedId(id);
        setSelectVersion((v) => v + 1);
      }}
      // The overlay follows the same movement preferences as the main window — they are
      // localStorage-backed, so both pages read the one setting.
      trackPlayer={prefs.trackPlayer}
      smoothMovement={prefs.smoothMovement}
      predictiveMovement={prefs.predictiveMovement}
      compact
    />
  );
}
