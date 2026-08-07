// EQ con-color bands, derived from the client's own runtime con table.
//
// The client builds a 131x131 int8 table at startup and indexes it as
// [myLevel][targetLevel]; its builder reduces to the closed form below.
//
// Above the player the bands are flat: +1..+5 yellow, +6 and up red.
// Below the player they compress with level — the light-blue and grey bases
// scale as 3/4 and 2/3 of the player level until 60, then flatten to -15 and
// -20 — and each base clamps against the band above it, so a band vanishes
// once there is no room for it. That clamping is why low levels show no
// green or light blue at all: at level 10, 5-9 is dark blue and 1-4 grey.
//
// This replaced a hand-tuned per-level ladder ported from the legacy
// Player::fillConTable, which capped yellow at +3 and disagreed with the
// client at 19 player levels (one-level errors at the grey/green edge).

export type Con =
  | 'gray'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'white'
  | 'yellow'
  | 'red';

const CON_HEX: Record<Con, string> = {
  gray:   '#808080',
  green:  '#00b050',
  cyan:   '#00e0e0',
  blue:   '#4060ff',
  white:  '#ffffff',
  yellow: '#ffd040',
  red:    '#ff3030',
};

export function conOf(playerLevel: number, spawnLevel: number): Con {
  if (!playerLevel || !spawnLevel) return 'white';

  const diff = spawnLevel - playerLevel;
  if (diff >= 6) return 'red';
  if (diff >= 1) return 'yellow';
  if (diff === 0) return 'white';

  // Lowest spawn level that cons light blue / green.
  const cyanBase = Math.min(
    playerLevel <= 60 ? Math.floor((3 * playerLevel) / 4) : playerLevel - 15,
    playerLevel - 5,
  );
  const greenBase = Math.min(
    playerLevel <= 60 ? Math.floor((2 * playerLevel) / 3) : playerLevel - 20,
    cyanBase,
  );

  if (spawnLevel >= playerLevel - 5) return 'blue';
  if (spawnLevel >= cyanBase) return 'cyan';
  if (spawnLevel >= greenBase) return 'green';
  return 'gray';
}

export function conHex(c: Con): string {
  return CON_HEX[c];
}
