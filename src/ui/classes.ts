// Mirrors the player + NPC class lookup in scry-cpp/src/classes.h.
// Player classes are ids 1..16, GM variants 20..35, NPC service classes
// scattered above 40. Anything missing returns "" so callers render
// blank rather than a stray number.
const CLASSES: Record<number, string> = {
  1:  'Warrior',
  2:  'Cleric',
  3:  'Paladin',
  4:  'Ranger',
  5:  'Shadow Knight',
  6:  'Druid',
  7:  'Monk',
  8:  'Bard',
  9:  'Rogue',
  10: 'Shaman',
  11: 'Necromancer',
  12: 'Wizard',
  13: 'Magician',
  14: 'Enchanter',
  15: 'Beastlord',
  16: 'Berserker',
  20: 'Warrior GM',
  21: 'Cleric GM',
  22: 'Paladin GM',
  23: 'Ranger GM',
  24: 'ShadowKnight GM',
  25: 'Druid GM',
  26: 'Monk GM',
  27: 'Bard GM',
  28: 'Rogue GM',
  29: 'Shaman GM',
  30: 'Necromancer GM',
  31: 'Wizard GM',
  32: 'Magician GM',
  33: 'Enchanter GM',
  34: 'Beastlord GM',
  35: 'Berserker GM',
  40: 'Banker',
  41: 'Shopkeeper',
  59: 'Discord Merchant',
  60: 'LDoN Recruiter',
  61: 'LDoN Merchant',
  62: 'LDoN Object',
  63: 'Tribute Master',
  64: 'Guild Tribute Master',
  66: 'Guild Banker',
  67: "Norrath's Keepers Merchant",
  68: 'Dark Reign Merchant',
  69: 'Fellowship Registrar',
  70: 'Alt Currency Merchant',
  71: 'Mercenary Liaison',
  73: 'Loyalist Merchant',
};

export function classNameOf(id: number): string {
  return CLASSES[id] ?? '';
}

const CLASS_SHORT: Record<number, string> = {
  1: 'WAR', 2: 'CLR', 3: 'PAL', 4: 'RNG', 5: 'SHD', 6: 'DRU',
  7: 'MNK', 8: 'BRD', 9: 'ROG', 10: 'SHM', 11: 'NEC', 12: 'WIZ',
  13: 'MAG', 14: 'ENC', 15: 'BST', 16: 'BER',
};

export function classShortOf(id: number): string {
  return CLASS_SHORT[id] ?? classNameOf(id);
}

// EQL multiclass: classMask bit N = class id N (e.g. 224 = bits 5/6/7 =
// SHD/DRU/MNK). `primary` is the single/primary class, used when the mask
// is 0 (live/single-class). The multi-class join always uses abbreviations;
// pass `short` to abbreviate the single-class fallback too (target HUD) vs.
// the default full name (player panel / spawn list class column).
export function classDisplay(
  classMask: number,
  primary: number,
  opts?: { short?: boolean },
): string {
  if (classMask > 0) {
    const parts: string[] = [];
    for (let n = 1; n <= 16; n++) {
      if (classMask & (1 << n)) parts.push(classShortOf(n));
    }
    if (parts.length > 0) return parts.join('/');
  }
  return opts?.short ? classShortOf(primary) : classNameOf(primary);
}

// Pure-melee classes with no mana pool. GM variants share the parent
// class' resource model. Bard has mana (used for songs).
const NO_MANA_CLASSES: ReadonlySet<number> = new Set([
  1,  7,  9,  16,                 // Warrior, Monk, Rogue, Berserker
  20, 26, 28, 35,                 // GM variants of the same
]);

export function classHasMana(id: number): boolean {
  if (id <= 0) return true;       // unknown -> show bar, fail open
  return !NO_MANA_CLASSES.has(id);
}
