// Opens/closes the floating game overlay. Renders nothing in a browser — the overlay is a
// native always-on-top window, so there is no web fallback to offer.
import { useEffect, useState } from 'react';
import { PictureInPicture2 } from 'lucide-react';
import { toast } from 'sonner';
import { main } from '../overlay/bridge';

export function OverlayToggle() {
  const api = main();
  const [open, setOpen] = useState(false);

  // The overlay's own X button closes it behind our back, so ask rather than trust local state.
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const sync = async () => {
      const s = await api.overlay.status();
      if (alive) setOpen(Boolean(s?.exists));
    };
    void sync();
    const poll = setInterval(() => void sync(), 1000);
    return () => { alive = false; clearInterval(poll); };
  }, [api]);

  if (!api) return null;

  // Say out loud where the window went. An overlay that fails by being invisible otherwise
  // gives the user nothing to report.
  const openAndReport = async () => {
    try {
      const s = await api.overlay.open();
      if (!s?.exists) { toast.error('Overlay: no window was created.'); return; }
      const msg = `Overlay ${s.visible ? 'visible' : 'NOT visible'} — ${s.w}x${s.h} at ${s.x},${s.y} @${s.scale}x. Screens: ${s.displays.join(' ')}`;
      if (s.visible) toast.success(msg, { duration: 15000 });
      else toast.error(msg, { duration: 30000 });
    } catch (err) {
      toast.error(`Overlay failed to open: ${String(err)}`);
    }
  };

  return (
    <button
      type="button"
      title={open ? 'Close the game overlay' : 'Open the game overlay'}
      onClick={() => { void (open ? api.overlay.close() : openAndReport()); setOpen(!open); }}
      className={`flex h-6 items-center gap-1 rounded border border-border px-2 text-xs font-medium select-none ${
        open ? 'bg-primary text-primary-foreground' : 'bg-bg-alt text-muted-foreground hover:text-foreground'
      }`}
    >
      <PictureInPicture2 size={12} />
      Overlay
    </button>
  );
}
