// Where the daemon lives, shared by every page that opens a SeqClient — the main window
// and the overlay window. Same origin, so both read the same localStorage entry and the
// overlay follows the URL the user set in the header without any IPC.

// Match the page's scheme so an https-hosted UI doesn't trip mixed-content.
// Daemon is expected to run on the user's own machine, not the page origin.
const DEFAULT_WS_SCHEME = window.location.protocol === 'https:' ? 'wss' : 'ws';

export const DEFAULT_URL = `${DEFAULT_WS_SCHEME}://localhost:9090`;
export const URL_STORAGE_KEY = 'scry.daemonUrl';

export function daemonUrl(): string {
  return localStorage.getItem(URL_STORAGE_KEY) || DEFAULT_URL;
}

/**
 * A hosted-service session baked into the page URL: `/s/<id>` (the link a
 * scry-agent prints). The service serves this page and the session's
 * websocket from one origin, so the daemon URL is derived — same host,
 * `/s/<id>/ws` — never stored, and it wins over the saved daemon URL:
 * opening the link IS the session selection.
 */
export function sessionUrlFromLocation(
  loc: Pick<Location, 'pathname' | 'host' | 'protocol'> = window.location,
): string | null {
  const m = /^\/s\/([A-Za-z0-9_-]+)/.exec(loc.pathname);
  if (!m) return null;
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.host}/s/${m[1]}/ws`;
}

/**
 * `SCRY_DAEMON_URL=...` / `--url ...` from the desktop shell, or null.
 *
 * Wins over the stored value and is written back to it, so it CORRECTS a bad address rather
 * than shadowing it — the field shows what is in use, and the next launch without the
 * override keeps it.
 */
export async function daemonUrlOverride(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.scry) return null;
  try {
    return await window.scry.daemonUrlOverride();
  } catch {
    return null;
  }
}
