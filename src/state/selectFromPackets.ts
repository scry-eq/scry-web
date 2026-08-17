// Selection driven by /consider and target packets, per the user's toggles.
//
// Extracted from App so the map OVERLAY behaves the same way: it is the same map, and a
// window that ignores "select on target" is not a second view of the app, it is a different
// app. One implementation, two callers.
import type { Envelope } from '@gen/seq/v1/events_pb';
import { usePrefsStore } from './prefsStore';

/**
 * Apply one envelope to a selection setter. Returns true if it acted.
 *
 * Mirrors showeq-c interface.cpp:5035-5061: deselect-on-untarget runs INDEPENDENTLY of
 * select-on-target — clearing the target can drop the current selection even with
 * select-on-target off. The toggles are read at call time so the latest value is used
 * without re-subscribing on every change.
 */
export function selectFromPacket(env: Envelope, onSelect: (id: number | null) => void): boolean {
  const p = env.payload;
  const prefs = usePrefsStore.getState();
  if (p.case === 'considered' && p.value.spawnId && prefs.selectOnConsider) {
    onSelect(p.value.spawnId);
    return true;
  }
  if (p.case === 'targeted') {
    if (p.value.spawnId === 0) {
      if (prefs.deselectOnUntarget) {
        onSelect(null);
        return true;
      }
      return false;
    }
    if (prefs.selectOnTarget) {
      onSelect(p.value.spawnId);
      return true;
    }
  }
  return false;
}
