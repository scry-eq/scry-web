import { RefreshCw } from 'lucide-react';
import { useBoxStore } from '../state/boxStore';

// Header dropdown showing every EQ client the daemon has observed
// (Stage 4 of ../scry-cpp/docs/MULTIBOX_PLAN.md). Hidden when
// only zero or one boxes are present — no point cluttering the
// header for the single-client case. Selection emits SetActiveBox;
// the daemon broadcasts a fresh BoxListUpdated with the new
// active_box_id which flows back through useBoxStore.
//
// The refresh button re-sends SetActiveBox with the current box ID.
// The daemon treats a same-box SetActiveBox as a manual re-snapshot
// request so the client can resync without a box-swap dance.

interface Props {
  onChange: (boxId: string) => void;
}

export function BoxPicker({ onChange }: Props) {
  const boxes       = useBoxStore((s) => s.boxes);
  const activeBoxId = useBoxStore((s) => s.activeBoxId);

  if (boxes.length <= 1) return null;

  return (
    <label className="flex items-center gap-1 text-xs text-foreground/80">
      <span className="text-foreground/60">box</span>
      <select
        value={activeBoxId}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-bg-base px-1 py-0.5 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
      >
        {boxes.map((b) => {
          // All boxes share one host IP (same-host multibox), so the IP is
          // not a useful discriminator — label by character, zone, level.
          const name = b.displayName || b.boxId.slice(0, 10);
          const zone = b.zone ? ` — ${b.zone}` : '';
          const lvl  = b.level > 0 ? ` (L${b.level})` : '';
          return (
            <option key={b.boxId} value={b.boxId}>
              {name}{zone}{lvl}
            </option>
          );
        })}
      </select>
      <button
        type="button"
        title="Refresh current box"
        onClick={() => onChange(activeBoxId)}
        className="flex items-center text-foreground/50 hover:text-foreground transition-colors"
      >
        <RefreshCw size={12} />
      </button>
    </label>
  );
}
