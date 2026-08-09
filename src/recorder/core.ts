// Host-agnostic loot recorder: fed decoded Envelopes, emits LootRows to an
// injected sink. Live recording now happens in the daemon/scry (which share the
// same logic via seq-backend-eql's LootTracker); what remains here is the
// offline backfill path, scripts/loot-backfill.ts, which replays a .pbstream
// into the same DB. No WebSocket / SQLite here on purpose.
//
// EQL fires a color-286 loot message immediately followed by a LootTransaction
// (the next loot envelope) carrying the authoritative {corpse_id, item_id,
// quantity, coin_copper}. So a message row is held pending until its transaction
// arrives, then emitted enriched. Call flush() at end-of-stream to write a
// trailing message that never received one.
import type { Envelope } from '@gen/seq/v1/events_pb';
import {
  normalizeMob, parseEqlLootMessage, splitZoneInstance,
  type LootRow, type LootSink,
} from './loot';

const CC_USER_LOOT = 286;   // EQ ChatColor CC_User_Loot — EQL loot lines

export class LootRecorderCore {
  private zoneShort = '';
  private zoneBase = '';
  private instance = '';
  // Corpse+item keys already recorded from a loot window, so reopening a corpse
  // doesn't double-count. Message rows are NOT deduped against these — a taken
  // item and its corpse-contents entry are distinct signals.
  private readonly seenWindow = new Set<string>();
  // item name -> id, learned from window items (which carry the id parsed from
  // the item-link header). Fallback item_id for a message with no transaction.
  private readonly itemIdByName = new Map<string, number>();
  // Message row awaiting its LootTransaction.
  private pending: LootRow | null = null;
  private rows = 0;

  constructor(private readonly sink: LootSink, private readonly looter = '') {}

  count(): number { return this.rows; }

  applyEnvelope(env: Envelope): void {
    const p = env.payload;
    switch (p.case) {
      case 'snapshot':        this.flushPending(); this.setZone(p.value.zoneShort); break;
      case 'zoneChanged':     this.flushPending(); this.setZone(p.value.zoneShort); break;
      case 'chat':            this.onChat(p.value, this.tsOf(env)); break;
      case 'lootTransaction': this.onLootTransaction(p.value, this.tsOf(env)); break;
      case 'lootDrops':       this.onLootDrops(p.value, this.tsOf(env)); break;
    }
  }

  // Write a still-pending message row (one that never got a transaction). Hosts
  // call this at end of stream / on shutdown.
  flush(): void { this.flushPending(); }

  // server_ts_ms is zeroed in goldens/replay; fall back to receipt time.
  private tsOf(env: Envelope): number {
    const s = Number(env.serverTsMs);
    return s > 0 ? s : Date.now();
  }

  private setZone(zoneShort: string): void {
    if (!zoneShort) return;
    this.zoneShort = zoneShort;
    const { base, instance } = splitZoneInstance(zoneShort);
    this.zoneBase = base;
    this.instance = instance;
  }

  // PRIMARY path: every looted item produces a color-286 message naming the item
  // + mob + disposition. Held pending for its transaction.
  private onChat(c: { text: string; chatColor: number; coinCopper: number }, ts: number): void {
    if (c.chatColor !== CC_USER_LOOT) return;
    const parsed = parseEqlLootMessage(c.text);
    if (!parsed) return;
    this.flushPending();   // a prior message that never got a transaction
    this.pending = this.stamp({
      ts, source: 'message',
      itemName: parsed.item, itemId: this.itemIdByName.get(parsed.item) ?? null,
      icon: null, qty: parsed.qty,
      mobName: parsed.mob, mobNorm: normalizeMob(parsed.mob), corpseId: null,
      sold: parsed.sold ? 1 : 0, moneyCopper: c.coinCopper || parsed.moneyCopper,
      disposition: parsed.disposition,
    });
  }

  // The confirmation for the pending message: overwrite with the authoritative
  // wire values (item_id, corpse_id, quantity, sale coin) and emit. A corpse
  // coin pile names no item, so it is its own row and must not consume the
  // pending message — it arrives at loot-window open, before the item lines.
  private onLootTransaction(
    t: { corpseId: number; itemId: number; quantity: number; coinCopper: number; coinFromCorpse: boolean },
    ts: number,
  ): void {
    if (t.coinFromCorpse) {
      if (t.coinCopper > 0) this.writeCorpseCoin(t.coinCopper, ts);
      return;
    }
    const r = this.pending;
    if (!r) return;   // orphan transaction (no preceding message)
    if (t.itemId) r.itemId = t.itemId;
    if (t.corpseId) r.corpseId = t.corpseId;
    if (t.quantity) r.qty = t.quantity;
    r.moneyCopper = t.coinCopper;
    this.pending = null;
    this.write(r);
  }

  // Coin taken off a corpse. EQL auto-takes it, so receipt means acquired.
  private writeCorpseCoin(copper: number, ts: number): void {
    this.write(this.stamp({
      ts, source: 'coin',
      itemName: 'Coin', itemId: null, icon: null, qty: 1,
      mobName: '', mobNorm: '', corpseId: null,
      sold: 0, moneyCopper: copper, disposition: 'corpse_coin',
    }));
  }

  // COMPLEMENTARY path: a loot window carries the full corpse contents (icon +
  // corpse id + item id) — the drop-table view. Empty windows (auto-loot) have
  // no items. A reopened corpse re-sends its list, so dedup by corpse+item.
  private onLootDrops(
    ld: { corpseId: number; corpseName: string; items: ReadonlyArray<{ name: string; icon: number; itemId: number }> },
    ts: number,
  ): void {
    for (const it of ld.items) {
      const itemId = it.itemId || null;
      if (itemId) this.itemIdByName.set(it.name, itemId);
      const key = `${ld.corpseId} ${it.name}`;
      if (this.seenWindow.has(key)) continue;
      this.seenWindow.add(key);
      this.write(this.stamp({
        ts, source: 'window',
        itemName: it.name, itemId, icon: it.icon, qty: 1,
        mobName: ld.corpseName, mobNorm: normalizeMob(ld.corpseName), corpseId: ld.corpseId,
        sold: 0, moneyCopper: 0, disposition: null,
      }));
    }
  }

  private flushPending(): void {
    if (this.pending) { this.write(this.pending); this.pending = null; }
  }

  // Attach the current zone + looter at the moment the event is parsed (not at
  // write time), so a deferred row keeps the zone it was looted in.
  private stamp(partial: Omit<LootRow, 'zoneShort' | 'zoneBase' | 'instance' | 'looter'>): LootRow {
    return {
      ...partial,
      zoneShort: this.zoneShort, zoneBase: this.zoneBase, instance: this.instance,
      looter: this.looter,
    };
  }

  private write(row: LootRow): void {
    this.rows++;
    this.sink.write([row]);
  }
}
