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
 * `SCRY_DAEMON_URL=...` / `--url ...` from the desktop shell, or null.
 *
 * Wins over the stored value and is written back to it, so it is a way to CORRECT a bad
 * address rather than a parallel setting — the field shows what is in use, and the next
 * launch without the override keeps it.
 */
export async function daemonUrlOverride(): Promise<string | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('daemon_url_override');
  } catch {
    return null;
  }
}
