// Pure, I/O-free loot helpers: parse EQL loot lines, normalize mob names, split
// the EQL instance suffix off a zone, sum coin. Unit-tested in loot.test.ts and
// consumed by the host-agnostic recorder core (core.ts), so it must stay free of
// WebSocket / SQLite / Bun / Node imports.

// 'coin' rows are corpse coin piles: itemName is 'Coin' and money_copper
// carries the amount.
export type LootSource = 'message' | 'window' | 'coin';

// One persisted loot event. `source='message'` is the authoritative "loot I
// acquired" record (with disposition + money); `source='window'` is the corpse
// contents / drop-table view (with icon + corpse id). `item_id` stays null until
// the daemon parses it out of the item-link header (a follow-up).
export interface LootRow {
  ts: number;                 // epoch ms
  source: LootSource;
  itemName: string;
  itemId: number | null;
  icon: number | null;
  qty: number;
  mobName: string;            // raw, e.g. "an ice giant"
  mobNorm: string;            // article-stripped, lowercased — grouping key
  corpseId: number | null;
  zoneShort: string;
  zoneBase: string;           // instance suffix stripped
  instance: string;           // '', 'solo', 'multi', 'eqlraidgroup'
  sold: 0 | 1;
  moneyCopper: number;        // sale proceeds
  disposition: string | null; // 'inventory' | 'sold' | 'created' | storage dest | null
  looter: string;
}

export interface LootSink {
  write(rows: LootRow[]): void;
}

export interface ParsedLoot {
  item: string;
  qty: number;
  mob: string;                // raw mob phrase (no "'s corpse"), e.g. "an ice giant"
  sold: boolean;
  disposition: string | null; // 'inventory' | 'sold' | 'created' | storage dest | null
  moneyCopper: number;        // parsed from "sold it for <money>" (0 if not sold)
}

// EQL OP_LootMessage wording (chat color 286), verified by enumerating every
// distinct color-286 line in the eql-fighting fixture. Two families:
//   A (kept to inventory, bordered): "--You have looted a <item> from <mob>'s corpse.--"
//   B (auto-disposition):            "You looted <item> from <mob>'s corpse"
//        + " and sold it for <money>." | " and stored it in your <dest>" | " to create a <upgrade>"
// A leading count ("You looted 5 Bone Chips ...") becomes qty. Anything else on
// color 286 (e.g. "You receive no loot ...") matches neither and is ignored.
const KEPT_RX =
  /^--You have looted (?:(\d+) |an? )?(.+?) from (.+?)'s corpse\.--$/;
const AUTO_RX =
  /^You looted (?:(\d+) |an? )?(.+?) from (.+?)'s corpse(?: and sold it for (.+?)\.| and stored it in (?:your )?(.+)| to create (?:an? )?(.+))?$/;

const COIN: Record<string, number> = { platinum: 1000, gold: 100, silver: 10, copper: 1 };

export function parseMoneyToCopper(text: string): number {
  let total = 0;
  for (const m of text.matchAll(/(\d+)\s+(platinum|gold|silver|copper)/g)) {
    total += parseInt(m[1], 10) * COIN[m[2]];
  }
  return total;
}

export function parseEqlLootMessage(text: string): ParsedLoot | null {
  const t = text.trim();

  const kept = KEPT_RX.exec(t);
  if (kept) {
    return { item: kept[2], qty: qtyOf(kept[1]), mob: kept[3], sold: false, disposition: 'inventory', moneyCopper: 0 };
  }

  const a = AUTO_RX.exec(t);
  if (a) {
    const sold = a[4] !== undefined;
    const disposition = a[5] ? a[5].trim() : sold ? 'sold' : a[6] !== undefined ? 'created' : null;
    return {
      item: a[2], qty: qtyOf(a[1]), mob: a[3], sold, disposition,
      moneyCopper: sold ? parseMoneyToCopper(a[4]!) : 0,
    };
  }

  return null;
}

function qtyOf(count: string | undefined): number {
  return count ? parseInt(count, 10) : 1;
}

const ARTICLE_RX = /^(?:an?|the)\s+/i;
const CORPSE_SUFFIX_RX = /(?:'s)?\s+corpse$/i;

export function normalizeMob(name: string): string {
  return name
    .replace(ARTICLE_RX, '')
    .replace(CORPSE_SUFFIX_RX, '')
    .trim()
    .toLowerCase();
}

// EQL raid/solo instances are encoded as a zone-name suffix; strip it to get
// the base zone plus the instance flavor.
const INSTANCE_SUFFIXES = ['_eqlraidgroup', '_multi', '_solo'];

export function splitZoneInstance(zoneShort: string): { base: string; instance: string } {
  for (const s of INSTANCE_SUFFIXES) {
    if (zoneShort.endsWith(s)) return { base: zoneShort.slice(0, -s.length), instance: s.slice(1) };
  }
  return { base: zoneShort, instance: '' };
}
