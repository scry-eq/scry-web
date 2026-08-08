// Shared read contract for the loot DB — used by the Bun HTTP host (browser
// path) and, later, the tauri-plugin-sql adapter (desktop path). Snake_case
// mirrors the `loot` table columns exactly (see schema.ts).

export interface LootRecord {
  id: number;
  ts: number;
  source: 'message' | 'window' | 'coin';
  item_name: string;
  item_id: number | null;
  icon: number | null;
  qty: number;
  mob_name: string | null;
  mob_norm: string | null;
  corpse_id: number | null;
  zone_short: string | null;
  zone_base: string | null;
  instance: string | null;
  sold: number;
  money_copper: number;
  disposition: string | null;
  looter: string | null;
}

export const LOOT_COLUMNS =
  'id, ts, source, item_name, item_id, icon, qty, mob_name, mob_norm, ' +
  'corpse_id, zone_short, zone_base, instance, sold, money_copper, disposition, looter';

// Most-recent loot first. The UI fetches a bounded window and does its own
// search / sort / aggregation in memory (a personal loot DB is small).
export const RECENT_LOOT_SQL = `SELECT ${LOOT_COLUMNS} FROM loot ORDER BY ts DESC, id DESC LIMIT ?`;
