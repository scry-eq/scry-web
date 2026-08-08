import { FloatingWindow } from './FloatingWindow';
import type { MoneyTotals, SpawnStore } from '../state/store';

function formatTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

// Compact coin readout. Suppresses zero denominations entirely so a
// pure-platinum drop reads as "12p" instead of "12p 0g 0s 0c". Falls
// back to "0c" only when nothing has been looted at all.
function formatMoney(m: MoneyTotals): string {
  const parts: string[] = [];
  if (m.platinum) parts.push(`${formatCount(m.platinum)}p`);
  if (m.gold)     parts.push(`${formatCount(m.gold)}g`);
  if (m.silver)   parts.push(`${formatCount(m.silver)}s`);
  if (m.copper)   parts.push(`${formatCount(m.copper)}c`);
  return parts.length > 0 ? parts.join(' ') : '0c';
}

// Carrying split of a single amount — unlike the session MoneyTotals, which
// deliberately sums each denomination without carrying.
function formatCopper(copper: number): string {
  const parts: string[] = [];
  const p = Math.floor(copper / 1000);
  const g = Math.floor(copper / 100) % 10;
  const s = Math.floor(copper / 10) % 10;
  const c = copper % 10;
  if (p) parts.push(`${formatCount(p)}p`);
  if (g) parts.push(`${g}g`);
  if (s) parts.push(`${s}s`);
  if (c) parts.push(`${c}c`);
  return parts.length > 0 ? parts.join(' ') : '0c';
}

// Short tag for where an item went, for the ones that don't stay in your bags.
function dispositionTag(d: string | null): string {
  switch (d) {
    case 'tradeskill depot': return 'depot';
    case 'Dragon Hoard':     return 'hoard';
    case 'created':          return 'combine';
    default:                 return '';
  }
}

type Aggregate = {
  itemName: string;
  count: number;
  yourCount: number;
  lastTs: number;
  soldCopper: number;   // summed sale proceeds for this item this session
  disposition: string | null;
};

export function LootWindow({
  store,
  tick,
  onClose,
}: {
  store: SpawnStore;
  tick: number;
  onClose: () => void;
}) {
  void tick;
  // Re-aggregating on every render is cheap (<= LOOT_LOG_LIMIT entries)
  // and avoids needing a separate cache invalidation when the user hits
  // Clear.
  const entries = store.lootEntries();
  const money = store.moneyTotal();
  const aggregates = new Map<string, Aggregate>();
  for (const e of entries) {
    const a = aggregates.get(e.itemName);
    const isYou = e.looter === '';
    if (a) {
      a.count += e.qty;
      if (isYou) a.yourCount += e.qty;
      if (e.localTs > a.lastTs) a.lastTs = e.localTs;
      a.soldCopper += e.soldCopper ?? 0;
      if (e.disposition) a.disposition = e.disposition;
    } else {
      aggregates.set(e.itemName, {
        itemName: e.itemName,
        count: e.qty,
        yourCount: isYou ? e.qty : 0,
        lastTs: e.localTs,
        soldCopper: e.soldCopper ?? 0,
        disposition: e.disposition,
      });
    }
  }
  // Newest activity first; ties broken by name for stable display.
  const rows = Array.from(aggregates.values()).sort((a, b) => {
    if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
    return a.itemName.localeCompare(b.itemName);
  });
  const recent = entries.slice(-5).reverse();

  return (
    <FloatingWindow
      id="loot"
      title={`Loot · ${entries.length}`}
      defaultSize={{ w: 320, h: 380 }}
      onClose={onClose}
      headerExtras={
        <button
          type="button"
          onClick={() => store.clearLootLog()}
          className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-bg-base hover:text-foreground"
          title="Clear session loot"
        >
          Clear
        </button>
      }
    >
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {rows.length === 0 ? (
            <div className="py-2 text-center text-xs text-muted-foreground">
              No loot yet this session
            </div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.itemName} className="border-b border-border/40 last:border-0">
                    <td className="py-0.5 text-foreground">
                      {r.itemName}
                      {r.yourCount === 0 && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          group
                        </span>
                      )}
                      {dispositionTag(r.disposition) && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide text-sky-500">
                          {dispositionTag(r.disposition)}
                        </span>
                      )}
                    </td>
                    <td className="py-0.5 text-right font-mono text-amber-500">
                      ×{r.count}
                      {r.yourCount > 0 && r.yourCount < r.count && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          ({r.yourCount} you)
                        </span>
                      )}
                    </td>
                    <td className="py-0.5 pl-2 text-right font-mono text-[11px] text-emerald-500">
                      {r.soldCopper > 0 ? formatCopper(r.soldCopper) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-border bg-bg-base/50 px-2 py-1">
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Recent ({recent.length})
          </div>
          <div className="max-h-24 overflow-y-auto font-mono text-[11px]">
            {recent.length === 0 ? (
              <div className="text-muted-foreground">—</div>
            ) : (
              recent.map((e, i) => (
                <div key={i} className="flex justify-between gap-2 leading-tight">
                  <span className="text-muted-foreground">{formatTime(e.localTs)}</span>
                  <span className="flex-1 truncate text-foreground">
                    <span className="text-muted-foreground">
                      {e.looter === '' ? 'you' : e.looter}
                    </span>
                    {' · '}
                    {e.itemName}
                    {e.soldCopper !== undefined && e.soldCopper > 0 && (
                      <span className="ml-1 text-emerald-500">
                        {formatCopper(e.soldCopper)}
                      </span>
                    )}
                    {dispositionTag(e.disposition) && (
                      <span className="ml-1 text-sky-500">
                        {dispositionTag(e.disposition)}
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-2 border-t border-border bg-bg-alt px-2 py-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Money
          </span>
          <span className="font-mono text-xs text-amber-400">
            {formatMoney(money)}
          </span>
        </div>
    </FloatingWindow>
  );
}
