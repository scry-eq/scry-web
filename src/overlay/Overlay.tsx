import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Lock, LockOpen, X } from 'lucide-react';
import { onHover, onLocked, overlay, inTauri } from './bridge';
import { useDaemon } from './useDaemon';

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
      <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-black/50">
        <div className={`h-full ${className}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums opacity-80">
        {max > 0 ? `${cur}/${max}` : '—'}
      </span>
    </div>
  );
}

export function Overlay() {
  const vitals = useDaemon();
  // Locked is the resting state and Rust owns it; these mirror it for rendering only.
  const [locked, setLocked] = useState(true);
  const [hover, setHover] = useState(!inTauri);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const un = [onHover((h) => setHover(h.inside)), onLocked(setLocked)];
    void overlay.locked().then(setLocked);
    return () => { un.forEach((p) => void p.then((f) => f())); };
  }, []);

  // The header is what stays clickable while locked, so its real rectangle is what Rust is
  // told — and it is measured while HIDDEN, since that is exactly when the user has to be
  // able to reach into it to bring it back.
  useLayoutEffect(() => {
    const push = () => {
      const el = headerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      void overlay.setHotZones([{ x: r.x, y: r.y, w: r.width, h: r.height }]);
    };
    push();
    const ro = new ResizeObserver(push);
    if (headerRef.current) ro.observe(headerRef.current);
    window.addEventListener('resize', push);
    return () => { ro.disconnect(); window.removeEventListener('resize', push); };
  }, []);

  const chrome = hover || !locked;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black/55 text-foreground shadow-lg backdrop-blur-sm">
      {/* Always mounted, never display:none — a hot zone with no rectangle is an overlay
          that can never be unlocked again. */}
      <div
        ref={headerRef}
        data-tauri-drag-region
        className={`flex h-7 shrink-0 items-center gap-2 border-b px-2 transition-opacity duration-150 ${
          chrome ? 'border-white/10 bg-white/5 opacity-100' : 'border-transparent opacity-0'
        }`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[vitals.status]}`} />
        <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-[11px] opacity-70">
          {vitals.zone || 'no zone'}
        </span>
        <button
          type="button"
          title={locked ? 'Unlock (click-through off)' : 'Lock (click-through on)'}
          onClick={() => void overlay.setLocked(!locked)}
          className="rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100"
        >
          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
        <button
          type="button"
          title="Close"
          onClick={() => void overlay.close()}
          className="rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100"
        >
          <X size={12} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 px-2.5 py-2">
        <Bar label="hp" cur={vitals.hpCur} max={vitals.hpMax} className="bg-red-500/80" />
        <Bar label="mana" cur={vitals.manaCur} max={vitals.manaMax} className="bg-sky-500/80" />
        <div className="flex items-baseline justify-between pt-0.5 text-[11px] opacity-70">
          <span>lvl {vitals.level || '—'}</span>
          <span className="font-mono tabular-nums">{vitals.spawns} spawns</span>
        </div>
      </div>
    </div>
  );
}
