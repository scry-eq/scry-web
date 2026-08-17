// Theme + colour-mode management. Two orthogonal axes:
//   * mode  — system | light | dark   (resolves system → matchMedia)
//   * theme — default | shadui | mui  (palette family)
// Both attributes are written to <html> as data-mode / data-theme; the
// inline bootstrap in index.html applies them before paint to avoid a
// flash. CSS in src/index.css keys off both attrs.

export type Mode = 'system' | 'light' | 'dark';
export type Theme = 'default' | 'shadui' | 'mui';

export const MODE_OPTIONS: Mode[] = ['system', 'light', 'dark'];
export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'shadui', label: 'ShadUI' },
  { value: 'mui', label: 'MUI' },
];

const KEY_MODE  = 'scry.theme.mode';
const KEY_THEME = 'scry.theme.name';

function isMode(v: unknown): v is Mode {
  return v === 'system' || v === 'light' || v === 'dark';
}
function isTheme(v: unknown): v is Theme {
  return v === 'default' || v === 'shadui' || v === 'mui';
}

export function getMode(): Mode {
  const raw = localStorage.getItem(KEY_MODE);
  return isMode(raw) ? raw : 'system';
}

export function getTheme(): Theme {
  const raw = localStorage.getItem(KEY_THEME);
  return isTheme(raw) ? raw : 'default';
}

function resolveMode(mode: Mode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyTheme(): void {
  const mode = getMode();
  const theme = getTheme();
  const root = document.documentElement;
  root.dataset.mode = resolveMode(mode);
  root.dataset.theme = theme;
}

export function setMode(mode: Mode): void {
  localStorage.setItem(KEY_MODE, mode);
  applyTheme();
  notify();
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY_THEME, theme);
  applyTheme();
  notify();
}

// --- subscription glue for React ----------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Re-resolve when the OS preference changes and mode=system.
let mediaWatcherInstalled = false;
export function installSystemModeWatcher(): void {
  if (mediaWatcherInstalled) return;
  mediaWatcherInstalled = true;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getMode() === 'system') {
      applyTheme();
      notify();
    }
  };
  mql.addEventListener('change', onChange);
}
