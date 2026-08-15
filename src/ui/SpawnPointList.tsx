import { useEffect, useMemo, useRef, useState } from 'react';
import {
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnSizingState,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SpawnStore } from '../state/store';
import type { SeqClient } from '../net/client';
import { runtimeX, runtimeY } from '../lib/coords';

// Mirrors showeq-c Spawn::cleanedName (spawn.cpp:834-839): strip ASCII
// digits and turn underscores into spaces. EQ wire names look like
// "a_Goblin_Warrior01" — the legacy spawn list applied this transform
// to the Name column, but the spawn-point Last column shipped raw on
// purpose so the operator could see the literal evidence and copy a
// clean version into the Name dialog by hand. Two decades of UX taste
// later, raw is just noise: every consumer wants "a Goblin Warrior".
function cleanedName(s: string): string {
  return s.replace(/[0-9]/g, '').replace(/_/g, ' ');
}

// Mirrors showeq-c spawnpointlist.cpp's column model: x/y/z, the
// remaining time until the next pop, the user-assigned name (if any),
// the most-recently-spawned mob, and the running count of pops we've
// observed. Time math is local — the daemon ships epoch seconds and
// the cycle length, the client ticks down off the wall clock.
type Row = {
  key: string;
  x: number;
  y: number;
  z: number;
  name: string;
  last: string;
  count: number;
  // null when we don't yet have both diff_time_s and death_time_s set;
  // the legacy UI rendered this as upside-down-question-mark + question
  // mark. We just show "?".
  remainingS: number | null;
  // Used to bold + redden the row when the mob is way overdue, mirroring
  // the legacy SpawnPointListItem::data ForegroundRole branch (age > 220
  // → red). With a max age of 255 that's effectively "spawn point is
  // 220/255 of one cycle past due".
  age: number;
};

// v9 composes table behaviour from explicit features; only what we name here
// is bundled. Sorting, plus resizable column widths.
const features = tableFeatures({
  rowSortingFeature,
  columnSizingFeature,
  columnResizingFeature,
  sortedRowModel: createSortedRowModel(),
  // Stock sort fns, so the auto-detected 'text'/'basic' names resolve;
  // unregistered, v9 falls back to a case-sensitive codepoint compare.
  sortFns,
});

const columnHelper = createColumnHelper<typeof features, Row>();

function fmtRemaining(s: number | null): string {
  if (s === null) return '?';
  if (!isFinite(s)) return 'up';
  if (s <= 0) return '  now';
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

function buildColumns(onRename: (key: string, currentName: string, last: string) => void) {
  return columnHelper.columns([
    // Display X/Y in EQ /loc (runtime) convention to match legacy + the
    // status bar; row.x/row.y stay screen convention for pan-to + key
    // identity. See lib/coords.
    columnHelper.accessor('x', {
      header: 'X',
      size: 60,
      cell: (info) => runtimeX(info.getValue()),
    }),
    columnHelper.accessor('y', {
      header: 'Y',
      size: 60,
      cell: (info) => runtimeY(info.getValue()),
    }),
    columnHelper.accessor('z', {
      header: 'Z',
      size: 60,
      cell: (info) => info.getValue().toFixed(1),
    }),
    columnHelper.accessor('remainingS', {
      header: 'Remaining',
      size: 80,
      cell: (info) => (
        <span className="font-mono">{fmtRemaining(info.getValue())}</span>
      ),
      sortFn: (a, b) => {
        // null sorts last so unknown-cycle points settle at the bottom.
        const av = a.original.remainingS;
        const bv = b.original.remainingS;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv;
      },
    }),
    columnHelper.accessor('name', {
      header: 'Name',
      cell: (info) => {
        const row = info.row.original;
        return (
          <span
            className="cursor-pointer underline-offset-2 hover:underline"
            title="Double-click to rename"
            onDoubleClick={() => onRename(row.key, row.name, row.last)}
          >
            {info.getValue() || '—'}
          </span>
        );
      },
    }),
    columnHelper.accessor('last', {
      header: 'Last',
      cell: (info) => info.getValue() || '—',
    }),
    columnHelper.accessor('count', { header: 'Count', size: 60 }),
  ]);
}

export function SpawnPointList({
  store,
  tick,
  client,
  onPanTo,
}: {
  store: SpawnStore;
  tick: number;
  client: SeqClient | null;
  onPanTo?: (x: number, y: number) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Default sort matches showeq-c: ascending by remaining time so the
  // next-to-pop is at the top.
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'remainingS', desc: false },
  ]);
  // User-resized column widths, persisted across reloads.
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try {
      const raw = localStorage.getItem('spawnpointlist.colWidths');
      return raw ? (JSON.parse(raw) as ColumnSizingState) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem('spawnpointlist.colWidths', JSON.stringify(columnSizing));
  }, [columnSizing]);

  const rows = useMemo<Row[]>(() => {
    void tick;
    const nowS = Math.floor(Date.now() / 1000);
    return store.allSpawnPoints().map((sp) => {
      // Daemon ships uint64s as bigints. Coerce to plain numbers — EQ
      // wall-clock seconds fit in a double well past any plausible
      // session length.
      const death = Number(sp.deathTimeS);
      const diff = Number(sp.diffTimeS);
      let remaining: number | null = null;
      let age = 0;
      if (death !== 0 && diff !== 0) {
        remaining = diff - (nowS - death);
        // Mirrors SpawnPoint::age in showeq-c: 255 * (now-death)/diff,
        // clamped, used to redden heavily-overdue rows.
        age = Math.min(255, Math.max(0, Math.floor((255 * (nowS - death)) / diff)));
      } else if (death === 0 && diff !== 0) {
        // Mob is alive; cycle is learned. Infinity sorts after all countdowns
        // but before null (no-cycle-yet) in the remainingS sort.
        remaining = Infinity;
      }
      const row: Row = {
        key: sp.key,
        x: sp.x,
        y: sp.y,
        z: sp.z,
        name: sp.name,
        // Display the scrubbed form. Wire stays raw so other consumers
        // (e.g. logging, debug tools) keep the literal evidence.
        last: cleanedName(sp.last),
        count: sp.count,
        remainingS: remaining,
        age,
      };
      return row;
    });
  }, [store, tick]);

  const columns = useMemo(
    () =>
      buildColumns((key, currentName, last) => {
        if (!client) return;
        // Seed with the existing label, falling back to the scrubbed
        // last-spawn name so the operator gets a sensible default
        // instead of the raw "a_Goblin_Warrior01" the legacy dialog
        // pre-filled. Mirrors showeq-c spawnpointlist.cpp:307-322
        // (def = sp->name(); if empty, def = sp->last()) but with the
        // cleanup applied.
        const seed = currentName || last;
        const next = window.prompt('Spawn point name:', seed);
        if (next === null) return; // user cancelled
        client.renameSpawnPoint(key, next.trim());
      }),
    [client],
  );

  const table = useTable({
    features,
    data: rows,
    columns,
    state: { sorting, columnSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    // Stable row id so spawn-point churn doesn't shift TanStack ids and
    // unmount/remount every <tr>; matches the SpawnList convention.
    getRowId: (row) => row.key,
  });

  // Row virtualization — see SpawnList.tsx for rationale. Spawn-point
  // counts are typically smaller than spawn counts but a long-running
  // session in a busy zone can accumulate hundreds of points, and the
  // legacy unvirtualized render started costing real frame time around
  // ~200 rows.
  const sortedRows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ROW_HEIGHT = 22;
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const padTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const padBot = virtualItems.length > 0
    ? totalSize - virtualItems[virtualItems.length - 1].end
    : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
        <span>{rows.length} spawn point{rows.length === 1 ? '' : 's'}</span>
        <span className="font-mono">
          {rows.filter((r) => r.remainingS !== null && r.remainingS <= 0).length}
          {' '}up
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead className="sticky top-0 z-[2] bg-bg-alt">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sort = h.column.getIsSorted();
                  const canResize = h.column.getCanResize();
                  return (
                    <th
                      key={h.id}
                      className="relative select-none px-1.5 py-1 text-left font-medium text-foreground"
                      style={{ width: h.getSize() }}
                    >
                      <span
                        className="cursor-pointer"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sort === 'asc' ? ' ▲' : sort === 'desc' ? ' ▼' : ''}
                      </span>
                      {canResize && (
                        <span
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            h.getResizeHandler()(e);
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            h.getResizeHandler()(e);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className={
                            'absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none ' +
                            (h.column.getIsResizing()
                              ? 'bg-primary'
                              : 'hover:bg-primary/60')
                          }
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr style={{ height: padTop }}>
                <td colSpan={columns.length} />
              </tr>
            )}
            {virtualItems.map((vi) => {
              const r = sortedRows[vi.index];
              // Legacy rule: bold + red text when the mob is heavily
              // overdue (age > 220 ≈ 86% past cycle).
              const overdue = r.original.age > 220;
              const isSelected = r.original.key === selectedKey;
              return (
                <tr
                  key={r.id}
                  style={{ height: ROW_HEIGHT }}
                  className={
                    'cursor-pointer border-b border-border ' +
                    (isSelected
                      ? 'bg-primary/20 hover:bg-primary/30'
                      : overdue
                      ? 'font-bold text-red-600 dark:text-red-400 hover:bg-bg-alt/60'
                      : 'hover:bg-bg-alt/60')
                  }
                  onClick={() => {
                    setSelectedKey(r.original.key);
                    onPanTo?.(r.original.x, r.original.y);
                  }}
                >
                  {r.getAllCells().map((c) => (
                    <td key={c.id} className="px-1.5 py-0.5 align-middle">
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {padBot > 0 && (
              <tr style={{ height: padBot }}>
                <td colSpan={columns.length} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
