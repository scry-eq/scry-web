import type { SpawnStore } from '../state/store';
import { classDisplay, classHasMana } from './classes';

function pct(cur: number, max: number): number {
  if (!max || max <= 0) return 0;
  return Math.max(0, Math.min(100, (cur / max) * 100));
}

function fmt(n: number): string {
  return n.toLocaleString();
}

// Split a copper total into EQ denominations (base-10: 1000c = 1p, 100c =
// 1g, 10c = 1s). Returns only the non-zero denominations so the readout
// stays terse, e.g. 12006 -> "12p 6c". Each part keeps its denom letter
// separate so it's easy to swap for a coin icon later.
function moneyParts(copper: number): { key: string; amount: number; denom: string }[] {
  return [
    { key: 'p', amount: Math.floor(copper / 1000),      denom: 'p' },
    { key: 'g', amount: Math.floor(copper / 100) % 10,  denom: 'g' },
    { key: 's', amount: Math.floor(copper / 10) % 10,   denom: 's' },
    { key: 'c', amount: copper % 10,                     denom: 'c' },
  ].filter((d) => d.amount > 0);
}

// OP_Stamina food/water are uint32 "ticks till next eat/drink" — they count
// down from a full meal (~6000) to 0 = hungry/thirsty, so % of the full value
// reads as a "how full" gauge. Same struct on live + eql. Classic EQ tops out
// near 6000; if a full eat/drink doesn't read ~100% live, bump this.
const STAMINA_MAX = 6000;

// Food/water saturation -> warning color: green while comfortable, amber
// getting low, red about to go hungry/thirsty.
function satColor(v: number): string {
  const p = pct(v, STAMINA_MAX);
  if (p > 50) return 'text-emerald-600 dark:text-emerald-300';
  if (p > 20) return 'text-amber-600 dark:text-amber-300';
  return 'text-red-600 dark:text-red-400';
}

// Thin EQ-style bar: colored fill with the readout drawn OVER it — label +
// cur/max at the left, percent at the right edge. White text with a dark
// outline shadow so it stays legible over both the fill and the empty
// track in either theme. When `numericRight` is given (Exp/AA) the raw
// cur/max is meaningless, so we hide the left number and let `centerInfo`
// (XP rate) fill the middle; `numericRight` becomes the right-edge value.
function Bar({
  label,
  cur,
  max,
  color,
  numericRight,
  centerInfo,
}: {
  label: string;
  cur: number;
  max: number;
  color: string;
  numericRight?: string;
  centerInfo?: string;
}) {
  const p = pct(cur, max);
  const showCurMax = numericRight === undefined;
  const right = numericRight ?? (max > 0 ? `${Math.round(p)}%` : '—');
  return (
    <div className="relative mx-2 h-[15px] overflow-hidden rounded-sm bg-bg-base">
      <div
        className={`absolute inset-y-0 left-0 transition-[width] duration-200 ease-out ${color}`}
        style={{ width: `${p}%` }}
      />
      <div
        className="absolute inset-0 flex items-center gap-1.5 px-1.5 font-mono text-[10px] leading-none text-white"
        style={{
          // 8-way 1px dark shadow = a solid outline (crisper than a soft
          // blur), plus a thin stroke painted UNDER the fill so the white
          // stays legible over light fills (End/Exp/AA) and the empty track,
          // in both themes.
          textShadow:
            '1px 0 0 rgba(0,0,0,0.9),-1px 0 0 rgba(0,0,0,0.9),0 1px 0 rgba(0,0,0,0.9),0 -1px 0 rgba(0,0,0,0.9),1px 1px 0 rgba(0,0,0,0.9),-1px -1px 0 rgba(0,0,0,0.9),1px -1px 0 rgba(0,0,0,0.9),-1px 1px 0 rgba(0,0,0,0.9)',
          WebkitTextStroke: '0.5px rgba(0,0,0,0.55)',
          paintOrder: 'stroke fill',
        }}
      >
        <span className="shrink-0 font-sans uppercase tracking-wide opacity-90">{label}</span>
        {showCurMax && (
          <span className="tabular-nums">{max > 0 ? `${fmt(cur)} / ${fmt(max)}` : '—'}</span>
        )}
        {centerInfo && <span className="min-w-0 flex-1 truncate text-center">{centerInfo}</span>}
        <span className="ml-auto shrink-0 tabular-nums">{right}</span>
      </div>
    </div>
  );
}

// AA bar label. Live carries spent + unspent independently; Quarm only
// has unspent (spent stays 0). Show whichever side is nonzero, falling
// back to a bare "AA" before the profile arrives.
function aaLabel(spent: number, unspent: number): string {
  const parts: string[] = [];
  if (spent > 0) parts.push(`${fmt(spent)} spent`);
  if (unspent > 0) parts.push(`${fmt(unspent)} ready`);
  return parts.length === 0 ? 'AA' : `AA · ${parts.join(' · ')}`;
}

// "1h 23m" / "12m 34s" / ">99h" / "—". Matches the granularity people
// actually care about when watching an XP bar tick.
function fmtDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec >= 100 * 3600) return '>99h';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function PanelButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-border bg-bg-base px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground hover:border-ring/60 hover:bg-accent hover:text-accent-foreground"
    >
      {label}
    </button>
  );
}

export function PlayerPanel({
  store,
  tick,
  onOpenSkills,
  onOpenStats,
  onOpenLoot,
  onOpenItems,
  onOpenAA,
  onOpenGuild,
}: {
  store: SpawnStore;
  tick: number;
  onOpenSkills?: () => void;
  onOpenStats?: () => void;
  onOpenLoot?: () => void;
  onOpenItems?: () => void;
  onOpenAA?: () => void;
  onOpenGuild?: () => void;
}) {
  // tick is just a dependency so the panel re-reads after each store apply.
  void tick;
  const s = store.stats();
  const rate = store.expRate();

  if (!s) {
    return (
      <div className="px-2 py-2 text-xs text-muted-foreground">
        Waiting for player profile…
      </div>
    );
  }

  const className = classDisplay(s.classMask, s.class);
  const headerLabel = s.name ? `${s.name}` : '(unknown)';

  return (
    <div className="flex flex-col gap-1 py-1">
      {/* Name + action buttons on one row; the level/class + money rows below
          get the full panel width so they don't fight the buttons for space. */}
      <div className="flex items-start justify-between gap-2 px-2 pt-0.5">
        <div className="min-w-0 truncate text-sm font-semibold text-foreground">{headerLabel}</div>
        <div className="flex shrink-0 gap-1">
          {onOpenStats && <PanelButton label="Stats" onClick={onOpenStats} />}
          {onOpenSkills && <PanelButton label="Skills" onClick={onOpenSkills} />}
          {onOpenAA && <PanelButton label="AA" onClick={onOpenAA} />}
          {onOpenGuild && <PanelButton label="Guild" onClick={onOpenGuild} />}
          {onOpenLoot && <PanelButton label="Loot" onClick={onOpenLoot} />}
          {onOpenItems && <PanelButton label="Items" onClick={onOpenItems} />}
        </div>
      </div>
      {(s.level || className) && (
        <div className="flex items-center justify-between gap-2 whitespace-nowrap px-2 text-[11px] text-muted-foreground">
          <span>{s.level ? `Level ${s.level}` : ''}</span>
          {className && <span className="truncate">{className}</span>}
        </div>
      )}
      {s.moneyCopper > 0 && (
        <div className="flex items-center gap-1.5 px-2 font-mono text-[11px]">
          {moneyParts(s.moneyCopper).map((d) => (
            <span key={d.key} className="text-foreground">
              {d.amount}<span className="text-muted-foreground">{d.denom}</span>
            </span>
          ))}
        </div>
      )}

      {/* EQL active stance + invocation (empty on live/single-class, so the
          line and each half hide when unset). Compact readout, not a bar. */}
      {(s.stance || s.invocation) && (
        <div className="flex items-center gap-x-1.5 px-2 text-[11px] text-muted-foreground">
          {s.stance && (
            <span>
              <span className="uppercase tracking-wide opacity-80">Stance</span>{' '}
              <span className="text-foreground">{s.stance}</span>
            </span>
          )}
          {s.stance && s.invocation && <span className="opacity-50">·</span>}
          {s.invocation && (
            <span>
              <span className="uppercase tracking-wide opacity-80">Invocation</span>{' '}
              <span className="text-foreground">{s.invocation}</span>
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <Bar label="HP"   cur={s.hpCur}      max={s.hpMax}      color="bg-red-600" />
        {classHasMana(s.class) && (
          <Bar label="Mana" cur={s.manaCur} max={s.manaMax} color="bg-blue-600" />
        )}
        <Bar label="End"  cur={s.enduranceCur} max={s.enduranceMax} color="bg-amber-500" />
      </div>

      {/* Hunger/thirst (eql OP_Stamina). Live/test never send it (0/0), so gate
          on >0 rather than target-branching. Compact readout, not a full bar. */}
      {(s.food > 0 || s.water > 0) && (
        <div className="flex items-center gap-4 px-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="flex items-center gap-1">
            <span aria-hidden>🍗</span>Food
            <span className={'font-mono normal-case tracking-normal ' + satColor(s.food)}>
              {Math.round(pct(s.food, STAMINA_MAX))}%
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden>💧</span>Water
            <span className={'font-mono normal-case tracking-normal ' + satColor(s.water)}>
              {Math.round(pct(s.water, STAMINA_MAX))}%
            </span>
          </span>
        </div>
      )}

      <div className="mx-2 my-1 border-t border-border" />

      <div className="flex flex-col gap-0.5">
        <Bar
          label="Exp"
          cur={s.expCur}
          max={s.expMax}
          color="bg-yellow-400"
          numericRight={s.expMax > 0 ? `${pct(s.expCur, s.expMax).toFixed(1)}%` : '—'}
          centerInfo={
            rate
              ? `${rate.pctPerHour.toFixed(2)}% / hr · ${rate.msToLevel === null ? '—' : fmtDuration(rate.msToLevel)}`
              : undefined
          }
        />
        <Bar
          label={aaLabel(s.aaPoints, s.aaUnspent)}
          cur={s.aaExpCur}
          max={s.aaExpMax}
          color="bg-green-500"
          numericRight={s.aaExpMax > 0 ? `${pct(s.aaExpCur, s.aaExpMax).toFixed(1)}%` : '—'}
        />
      </div>
    </div>
  );
}
