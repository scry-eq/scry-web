// bun:sqlite LootSink — the persistence backend for the standalone Bun host
// (loot-backfill.ts). Lives
// under scripts/ (not src/) because bun:sqlite isn't part of the tsc build.
import { Database } from 'bun:sqlite';
import { SCHEMA } from '../src/recorder/schema';
import type { LootRow, LootSink } from '../src/recorder/loot';

export class BunSqliteSink implements LootSink {
  private readonly db: Database;
  private readonly ins;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.run(SCHEMA);
    this.ins = this.db.prepare(`
      INSERT INTO loot
        (ts, source, item_name, item_id, icon, qty, mob_name, mob_norm,
         corpse_id, zone_short, zone_base, instance, sold, money_copper, disposition, looter)
      VALUES
        ($ts, $source, $item_name, $item_id, $icon, $qty, $mob_name, $mob_norm,
         $corpse_id, $zone_short, $zone_base, $instance, $sold, $money_copper, $disposition, $looter)
    `);
  }

  write(rows: LootRow[]): void {
    for (const r of rows) {
      this.ins.run({
        $ts: r.ts, $source: r.source, $item_name: r.itemName, $item_id: r.itemId,
        $icon: r.icon, $qty: r.qty, $mob_name: r.mobName, $mob_norm: r.mobNorm,
        $corpse_id: r.corpseId, $zone_short: r.zoneShort, $zone_base: r.zoneBase,
        $instance: r.instance, $sold: r.sold, $money_copper: r.moneyCopper,
        $disposition: r.disposition, $looter: r.looter,
      });
    }
  }

  close(): void { this.db.close(); }
}
