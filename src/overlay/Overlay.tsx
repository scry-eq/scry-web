import { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen, X } from 'lucide-react';
import { KIND_LABEL, overlay } from './bridge';
import { useDaemon } from './useDaemon';
import { useSession } from './session';
import { MapOverlay } from './MapOverlay';

const DOT: Record<string, string> = {
  open: 'bg-emerald-400',
  connecting: 'bg-amber-400',
  closed: 'bg-red-500',
};

function Bar({ label, cur, max, className }: {
  label: string; cur: number; max: number; className: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (cur / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 shrink-0 text-[10px] uppercase tracking-wide opacity-60">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-white/10">
        <div className={`h-full ${className}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums opacity-80">
        {max > 0 ? `${cur}/${max}` : '—'}
      </span>
    </div>
  );
}

export function Overlay() {
  const api = overlay();
  const kind = api?.kind ?? 'vitals';
  // The map needs the whole world, so that window opens a store-backed session; the vitals
  // strip needs four numbers and keeps its cheaper client.
  const session = useSession();
  const vitals = useDaemon(kind === 'vitals');
  const [locked, setLocked] = useState(false);
  const [hover, setHover] = useState(!api);
  // Where the pointer cannot be seen through a click-through window, the chrome must stay
  // put — otherwise locking hides the only control that unlocks it.
  const [forwards, setForwards] = useState(true);
  const headerRef = useRef<HTMLDivElement>(null);
  // What we last asked main for, so an unchanged answer costs no IPC.
  const ignoring = useRef<boolean | null>(null);

  useEffect(() => {
    if (!api) return;
    void api.locked().then(setLocked);
    void api.forwardsMouse().then(setForwards);
    return api.onLockedChanged(setLocked);
  }, [api]);

  // THE WHOLE HOVER MECHANISM. A locked overlay is click-through, but `forward: true` keeps
  // mouse-moves arriving, so the window can still tell where the pointer is and hand capture
  // back for the header — which is why there is no cursor sampling and no hot-zone bookkeeping
  // anywhere in this app.
  useEffect(() => {
    if (!api) return;
    const ask = (ignore: boolean): void => {
      if (ignoring.current === ignore) return;
      ignoring.current = ignore;
      void api.setIgnoreMouse(ignore);
    };
    const onMove = (e: MouseEvent): void => {
      setHover(true);
      const r = headerRef.current?.getBoundingClientRect();
      const overChrome = !!r && e.clientY >= r.top && e.clientY <= r.bottom;
      ask(locked && !overChrome);
    };
    const onLeave = (): void => {
      setHover(false);
      ask(locked);
    };
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, [api, locked]);

  const chrome = hover || !locked || !forwards;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/25 bg-black/75 text-foreground shadow-lg backdrop-blur-sm">
      {/* Always mounted, never display:none — the pointer has to be able to find it to get
          the overlay back, so only its opacity changes. */}
      <div
        ref={headerRef}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className={`flex h-7 shrink-0 items-center gap-2 border-b px-2 transition-opacity duration-150 ${
          chrome ? 'border-white/10 bg-white/5 opacity-100' : 'border-transparent opacity-0'
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            kind === 'map' ? (session.client ? 'bg-emerald-400' : 'bg-amber-400') : DOT[vitals.status]
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] opacity-70">
          {kind === 'map' ? KIND_LABEL[kind] : vitals.zone || 'no zone'}
        </span>
        <button
          type="button"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={locked ? 'Unlock (click-through off)' : 'Lock (click-through on)'}
          onClick={() => void api?.setLocked(!locked)}
          className="rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100"
        >
          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
        <button
          type="button"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Close"
          onClick={() => void api?.close()}
          className="rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100"
        >
          <X size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {kind === 'map' ? (
          <MapOverlay session={session} />
        ) : (
          <div className="flex h-full flex-col justify-center gap-2 px-2.5 py-2">
            <Bar label="hp" cur={vitals.hpCur} max={vitals.hpMax} className="bg-red-500/80" />
            <Bar label="mana" cur={vitals.manaCur} max={vitals.manaMax} className="bg-sky-500/80" />
            <div className="flex items-baseline justify-between pt-0.5 text-[11px] opacity-70">
              <span>lvl {vitals.level || '—'}</span>
              <span className="font-mono tabular-nums">{vitals.spawns} spawns</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
