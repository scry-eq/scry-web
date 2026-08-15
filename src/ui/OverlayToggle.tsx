// Opens/closes the floating game overlay. Renders nothing in a plain browser — the overlay
// is a native always-on-top window, so there is no web fallback to offer.
import { useEffect, useState } from 'react';
import { PictureInPicture2 } from 'lucide-react';
import { getAllWindows } from '@tauri-apps/api/window';
import { toast } from 'sonner';
import { inTauri, overlay } from '../overlay/bridge';

// Open, then say out loud where the window went. An overlay that fails by being invisible
// gives the user nothing to report; this puts the OS's own answer in front of them.
async function reportOpen(): Promise<void> {
  try {
    await overlay.open();
  } catch (err) {
    toast.error(`Overlay failed to open: ${String(err)}`);
    return;
  }
  // The window is shown from a queued main-thread task, so its geometry is not final the
  // instant open() returns.
  await new Promise((r) => setTimeout(r, 700));
  const s = await overlay.status();
  if (!s) return;
  if (!s.exists) {
    toast.error('Overlay: no window was created.');
    return;
  }
  const where = `${s.w}x${s.h} at ${s.x},${s.y} @${s.scale}x`;
  const how = `${s.locked ? 'locked' : 'unlocked'}, ${s.opaque ? 'opaque' : 'transparent'}`;
  const msg = `Overlay ${s.visible ? 'visible' : 'NOT visible'} — ${where} (${how}). Screens: ${s.monitors.join(' ')}`;
  if (s.visible) toast.success(msg, { duration: 30000 });
  else toast.error(msg, { duration: 30000 });
}

export function OverlayToggle() {
  const [open, setOpen] = useState(false);

  // The overlay's own X button closes it behind our back, so read the window list rather
  // than trusting local state.
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    const sync = async () => {
      const has = (await getAllWindows()).some((w) => w.label === 'overlay');
      if (alive) setOpen(has);
    };
    void sync();
    const poll = setInterval(() => void sync(), 1000);
    return () => { alive = false; clearInterval(poll); };
  }, []);

  if (!inTauri) return null;

  return (
    <button
      type="button"
      title={open ? 'Close the game overlay' : 'Open the game overlay'}
      onClick={() => { void (open ? overlay.close() : reportOpen()); setOpen(!open); }}
      className={`flex h-6 items-center gap-1 rounded border border-border px-2 text-xs font-medium select-none ${
        open ? 'bg-primary text-primary-foreground' : 'bg-bg-alt text-muted-foreground hover:text-foreground'
      }`}
    >
      <PictureInPicture2 size={12} />
      Overlay
    </button>
  );
}
