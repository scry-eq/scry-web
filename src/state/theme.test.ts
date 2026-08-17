import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_OPTIONS, applyTheme, getMode, getTheme, setMode, setTheme, subscribe } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-mode');
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});

describe('theme preferences', () => {
  it('offers, recognizes, persists, and applies MUI', () => {
    expect(THEME_OPTIONS).toContainEqual({ value: 'mui', label: 'MUI' });
    setTheme('mui');
    expect(localStorage.getItem('scry.theme.name')).toBe('mui');
    expect(getTheme()).toBe('mui');
    expect(document.documentElement.dataset.theme).toBe('mui');
  });

  it.each([
    ['light', false, 'light'], ['dark', false, 'dark'],
    ['system', false, 'light'], ['system', true, 'dark'],
  ] as const)('applies %s mode (OS dark: %s)', (mode, osDark, expected) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: osDark, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    localStorage.setItem('scry.theme.name', 'mui');
    setMode(mode);
    expect(getMode()).toBe(mode);
    expect(document.documentElement.dataset.mode).toBe(expected);
    expect(document.documentElement.dataset.theme).toBe('mui');
  });

  it('falls back for invalid stored values', () => {
    localStorage.setItem('scry.theme.name', 'unknown');
    localStorage.setItem('scry.theme.mode', 'sepia');
    applyTheme();
    expect(getTheme()).toBe('default');
    expect(getMode()).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('default');
    expect(document.documentElement.dataset.mode).toBe('light');
  });

  it('notifies subscribers when MUI is selected', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setTheme('mui');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    setTheme('default');
    expect(listener).toHaveBeenCalledOnce();
  });
});
