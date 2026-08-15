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
