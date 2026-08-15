// Opens/closes the floating game overlay. Renders nothing in a plain browser — the overlay
// is a native always-on-top window, so there is no web fallback to offer.
import { useEffect, useState } from 'react';
import { PictureInPicture2 } from 'lucide-react';
import { getAllWindows } from '@tauri-apps/api/window';
import { inTauri, overlay } from '../overlay/bridge';

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
      onClick={() => { void (open ? overlay.close() : overlay.open()); setOpen(!open); }}
      className={`flex h-6 items-center gap-1 rounded border border-border px-2 text-xs font-medium select-none ${
        open ? 'bg-primary text-primary-foreground' : 'bg-bg-alt text-muted-foreground hover:text-foreground'
      }`}
    >
      <PictureInPicture2 size={12} />
      Overlay
    </button>
  );
}
