// Mirrors scry-cpp/src/filtermgr.h filter-type indices. The Spawn
// proto's filter_flags field is a bitmask of (1 << index).
//
// Each filter has two color expressions:
//
// - `swatch`: a solid Tailwind utility used for the small (≤12px)
//   legend chips in FilterRulesPanel. At that size the row-tint alpha
//   washes out against the panel chrome, so the chip uses a vivid
//   solid shade-500 instead.
//
// - `rowTint` (in FILTER_ROW_TINT): the spawn-list row background.
//   Larger area, so a translucent shade-700 keeps the row visibly
//   tinted against the near-black canvas (#0a0e12) without burning
//   the eye. Filtered/Tracer have no row tint by design — they're
//   hide/debug categories, not "look at this" states.

export const FILTERS = [
  { bit: 1 << 0, label: 'Hunt',     swatch: 'bg-emerald-500' },
  { bit: 1 << 1, label: 'Caution',  swatch: 'bg-amber-500' },
  { bit: 1 << 2, label: 'Danger',   swatch: 'bg-red-500' },
  { bit: 1 << 3, label: 'Locate',   swatch: 'bg-blue-500' },
  { bit: 1 << 4, label: 'Alert',    swatch: 'bg-fuchsia-500' },
  { bit: 1 << 5, label: 'Filtered', swatch: 'bg-neutral-500' },
  { bit: 1 << 6, label: 'Tracer',   swatch: 'bg-neutral-500' },
] as const;

// Highest-priority match (lowest priority value) wins — a spawn that
// matches Danger AND Hunt renders red, not green.
export const FILTER_ROW_TINT: { bit: number; tint: string; priority: number }[] = [
  { bit: 1 << 2, tint: 'bg-red-700/40',     priority: 0 }, // Danger — strongest
  { bit: 1 << 1, tint: 'bg-amber-700/40',   priority: 1 }, // Caution
  { bit: 1 << 4, tint: 'bg-fuchsia-700/40', priority: 2 }, // Alert
  { bit: 1 << 0, tint: 'bg-emerald-700/40', priority: 3 }, // Hunt — confirmed target
  { bit: 1 << 3, tint: 'bg-blue-700/30',    priority: 4 }, // Locate — informational
];

export function tintForFilterFlags(flags: number): string {
  for (const f of FILTER_ROW_TINT) {
    if (flags & f.bit) return f.tint;
  }
  return '';
}

export function swatchForFilterTypeId(typeId: number): string {
  return FILTERS[typeId]?.swatch ?? 'bg-neutral-700';
}
