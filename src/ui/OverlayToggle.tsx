// Opens/closes the floating game overlays. Renders nothing in a browser — these are native
// always-on-top windows, so there is no web fallback to offer.
import { useEffect, useState } from 'react';
import { Check, PictureInPicture2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KIND_LABEL, OVERLAY_KINDS, main, type OverlayKind } from '../overlay/bridge';

export function OverlayToggle() {
  const api = main();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // An overlay's own X button closes it behind our back, so ask rather than trust local state.
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const sync = async () => {
      const all = await api.overlay.statusAll();
      if (!alive) return;
      setOpen(Object.fromEntries(all.map((s) => [s.kind, s.exists])));
    };
    void sync();
    const poll = setInterval(() => void sync(), 1000);
    return () => { alive = false; clearInterval(poll); };
  }, [api]);

  if (!api) return null;

  // Say out loud where the window went. An overlay that fails by being invisible otherwise
  // gives the user nothing to report.
  const toggle = async (kind: OverlayKind) => {
    if (open[kind]) {
      await api.overlay.close(kind);
      setOpen((o) => ({ ...o, [kind]: false }));
      return;
    }
    setOpen((o) => ({ ...o, [kind]: true }));
    try {
      const s = await api.overlay.open(kind);
      if (!s?.exists) { toast.error(`${KIND_LABEL[kind]} overlay: no window was created.`); return; }
      const msg = `${KIND_LABEL[kind]} overlay ${s.w}x${s.h} at ${s.x},${s.y} @${s.scale}x. Screens: ${s.displays.join(' ')}`;
      if (s.visible) toast.success(msg, { duration: 6000 });
      else toast.error(`NOT visible — ${msg}`, { duration: 30000 });
    } catch (err) {
      toast.error(`${KIND_LABEL[kind]} overlay failed to open: ${String(err)}`);
    }
  };

  const anyOpen = OVERLAY_KINDS.some((k) => open[k]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Floating game overlays"
          className={`flex h-6 items-center gap-1 rounded border border-border px-2 text-xs font-medium select-none ${
            anyOpen ? 'bg-primary text-primary-foreground' : 'bg-bg-alt text-muted-foreground hover:text-foreground'
          }`}
        >
          <PictureInPicture2 size={12} />
          Overlay
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {OVERLAY_KINDS.map((k) => (
          <DropdownMenuItem key={k} onSelect={() => void toggle(k)} className="text-xs">
            <Check size={12} className={open[k] ? 'opacity-100' : 'opacity-0'} />
            {KIND_LABEL[k]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
