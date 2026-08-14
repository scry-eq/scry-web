import { FloatingWindow } from './FloatingWindow';
import type { SpawnStore } from '../state/store';

// Indices into Item.stats[] / ItemCacheTotals.stats[]; mirrors
// ItemStatIndex in scry-cpp/src/itempacket.h.
const STAT_LABELS = ['STR', 'STA', 'AGI', 'DEX', 'CHA', 'INT', 'WIS'] as const;
// Indices into Item.resists[] / ItemCacheTotals.resists[]; mirrors
// ItemResistIndex.
const RESIST_LABELS = ['CR', 'DR', 'PR', 'MR', 'FR'] as const;
// Worn-slot labels keyed by slot index. Mirrors the EQ slot enum (see
// proto WornSet doc / scry-cpp/src/itempacket.h). Entries 23-30
// (PersonalInv) and 35 (Cursor) aren't gear and don't appear in totals.
const WORN_SLOT_LABELS: Record<number, string> = {
  0: 'Charm',
  1: 'Ear L',
  2: 'Head',
  3: 'Face',
  4: 'Ear R',
  5: 'Neck',
  6: 'Shoulder',
  7: 'Arms',
  8: 'Back',
  9: 'Wrist L',
  10: 'Wrist R',
  11: 'Range',
  12: 'Hands',
  13: 'Primary',
  14: 'Secondary',
  15: 'Finger L',
  16: 'Finger R',
  17: 'Chest',
  18: 'Legs',
  19: 'Feet',
  20: 'Waist',
  21: 'PowerSrc',
  22: 'Ammo',
};

function Cell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between rounded bg-bg-base px-1.5 py-1 text-xs">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-foreground">{value || '—'}</span>
    </div>
  );
}

export function InventoryStatsPanel({
  store,
  tick,
  onClose,
}: {
  store: SpawnStore;
  tick: number;
  onClose: () => void;
}) {
  void tick;
  const t = store.totals();
  const worn = store.wornItems();

  return (
    <FloatingWindow
      id="inventoryStats"
      title="Inventory totals"
      defaultSize={{ w: 340, h: 480 }}
      onClose={onClose}
    >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          <div className="text-[10px] text-muted-foreground">
            Sums HP/mana/AC/stats across the player's currently equipped
            gear, tracked via the OP_ItemPacket wrapper's main_slot /
            sub_slot fields. Empty slots and bagged items are excluded.
            Augment contributions are not yet folded in.
          </div>

          <div className="grid grid-cols-2 gap-1">
            <Cell label="Items" value={t?.itemCount ?? 0} />
            <Cell label="HP" value={t?.hp ?? 0} />
            <Cell label="Mana" value={t?.mana ?? 0} />
            <Cell label="End" value={t?.endurance ?? 0} />
            <Cell label="AC" value={t?.ac ?? 0} />
            {t?.corruption ? <Cell label="Corr" value={t.corruption} /> : null}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {STAT_LABELS.map((lbl, i) => (
              <Cell key={lbl} label={lbl} value={t?.stats[i] ?? 0} />
            ))}
          </div>

          <div className="grid grid-cols-5 gap-1">
            {RESIST_LABELS.map((lbl, i) => (
              <Cell key={lbl} label={lbl} value={t?.resists[i] ?? 0} />
            ))}
          </div>

          {worn.length > 0 && (
            <details className="rounded border border-border bg-bg-base/50" open>
              <summary className="cursor-pointer px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                Worn slots ({worn.length})
              </summary>
              <ul className="max-h-64 overflow-y-auto px-2 py-1 text-xs">
                {worn.map(({ slot, item }) => (
                  <li
                    key={slot}
                    className="flex items-baseline justify-between gap-2 border-b border-border/30 py-0.5 last:border-b-0"
                  >
                    <span className="shrink-0 w-16 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {WORN_SLOT_LABELS[slot] ?? `#${slot}`}
                    </span>
                    <span className="flex-1 truncate text-foreground" title={item.name}>
                      {item.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {item.hp ? `${item.hp}hp ` : ''}
                      {item.mana ? `${item.mana}m ` : ''}
                      {item.ac ? `${item.ac}ac` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
    </FloatingWindow>
  );
}
