import { describe, expect, it } from 'vitest';
import { lootSocketUrl } from './lootApi';

describe('lootSocketUrl', () => {
  it('appends /loot at the root for a classic daemon URL', () => {
    expect(lootSocketUrl('ws://localhost:9090')).toBe('ws://localhost:9090/loot');
    expect(lootSocketUrl('ws://10.0.0.5:9090/')).toBe('ws://10.0.0.5:9090/loot');
  });

  it("replaces a trailing /ws (scry's serve path) rather than nesting under it", () => {
    expect(lootSocketUrl('ws://localhost:4501/ws')).toBe('ws://localhost:4501/loot');
  });

  it('keeps a hosted session path: /s/<id>/ws -> /s/<id>/loot', () => {
    expect(lootSocketUrl('wss://ui.scry-eq.com/s/abc123/ws')).toBe(
      'wss://ui.scry-eq.com/s/abc123/loot',
    );
  });

  it('drops query/hash and preserves the scheme', () => {
    expect(lootSocketUrl('wss://host:9090/?x=1#y')).toBe('wss://host:9090/loot');
  });
});
