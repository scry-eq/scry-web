// Shared DDL. The daemon and scry create this same table (see the daemon's
// src/lootstore.cpp and scry's Scry.LootStore); this copy backs the offline
// backfill sink. One denormalized loot table keeps the by-item / by-mob /
// by-zone queries and stats trivial.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS loot (
  id           INTEGER PRIMARY KEY,
  ts           INTEGER NOT NULL,
  source       TEXT    NOT NULL,           -- 'message' (OP_LootMessage) | 'window' (OP_LootDrops) | 'coin' (corpse pile)
  item_name    TEXT    NOT NULL,
  item_id      INTEGER,                    -- null until the daemon emits the link-header id
  icon         INTEGER,                    -- dragitem icon id (window path only)
  qty          INTEGER NOT NULL DEFAULT 1,
  mob_name     TEXT,
  mob_norm     TEXT,                       -- article-stripped, lowercased
  corpse_id    INTEGER,
  zone_short   TEXT,
  zone_base    TEXT,
  instance     TEXT,
  sold         INTEGER NOT NULL DEFAULT 0,
  money_copper INTEGER NOT NULL DEFAULT 0,
  disposition  TEXT,                       -- 'sold' | storage destination | null
  looter       TEXT
);
CREATE INDEX IF NOT EXISTS loot_item ON loot(item_name);
CREATE INDEX IF NOT EXISTS loot_mob  ON loot(mob_norm);
CREATE INDEX IF NOT EXISTS loot_zone ON loot(zone_base);
`;
