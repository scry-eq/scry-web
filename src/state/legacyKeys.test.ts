import { describe, it, expect, beforeEach } from 'vitest';
import { migrateLegacyKeys } from './legacyKeys';

beforeEach(() => {
  localStorage.clear();
});

describe('migrateLegacyKeys', () => {
  it('copies pre-Scry keys onto the scry. prefix', () => {
    localStorage.setItem('showeq.layout', '{"v":1}');
    localStorage.setItem('showeq.windowPos.panel.spawns', '{"x":3,"y":4}');

    migrateLegacyKeys();

    expect(localStorage.getItem('scry.layout')).toBe('{"v":1}');
    expect(localStorage.getItem('scry.windowPos.panel.spawns')).toBe('{"x":3,"y":4}');
  });

  it('does not clobber a value already stored under the new prefix', () => {
    localStorage.setItem('showeq.prefs', 'old');
    localStorage.setItem('scry.prefs', 'new');

    migrateLegacyKeys();

    expect(localStorage.getItem('scry.prefs')).toBe('new');
  });

  it('leaves the old keys in place so a rollback still finds them', () => {
    localStorage.setItem('showeq.theme.mode', 'dark');

    migrateLegacyKeys();

    expect(localStorage.getItem('showeq.theme.mode')).toBe('dark');
  });

  it('ignores keys outside the old namespace', () => {
    localStorage.setItem('unrelated', 'x');
    localStorage.setItem('showeqNoDot', 'y');

    migrateLegacyKeys();

    expect(localStorage.getItem('scryNoDot')).toBeNull();
    expect(localStorage.getItem('scry.unrelated')).toBeNull();
  });

  it('is idempotent', () => {
    localStorage.setItem('showeq.layout', 'a');

    migrateLegacyKeys();
    localStorage.setItem('scry.layout', 'edited');
    migrateLegacyKeys();

    expect(localStorage.getItem('scry.layout')).toBe('edited');
  });
});
