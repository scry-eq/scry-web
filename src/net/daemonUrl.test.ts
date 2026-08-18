import { describe, expect, it } from 'vitest';
import { sessionUrlFromLocation } from './daemonUrl';

const loc = (pathname: string, host = 'ui.scry-eq.com', protocol = 'https:') => ({
  pathname,
  host,
  protocol,
});

describe('sessionUrlFromLocation', () => {
  it('derives the same-origin session websocket from /s/<id>', () => {
    expect(sessionUrlFromLocation(loc('/s/abc123'))).toBe('wss://ui.scry-eq.com/s/abc123/ws');
  });

  it('matches with a trailing path or slash (SPA fallback serves them all)', () => {
    expect(sessionUrlFromLocation(loc('/s/abc123/'))).toBe('wss://ui.scry-eq.com/s/abc123/ws');
    expect(sessionUrlFromLocation(loc('/s/abc123/anything'))).toBe(
      'wss://ui.scry-eq.com/s/abc123/ws',
    );
  });

  it('uses ws:// on a plain-http page (dev)', () => {
    expect(sessionUrlFromLocation(loc('/s/xyz', 'localhost:4501', 'http:'))).toBe(
      'ws://localhost:4501/s/xyz/ws',
    );
  });

  it('is null everywhere else — classic daemon selection stays in charge', () => {
    expect(sessionUrlFromLocation(loc('/'))).toBeNull();
    expect(sessionUrlFromLocation(loc('/overlay.html'))).toBeNull();
    expect(sessionUrlFromLocation(loc('/settings'))).toBeNull();
    expect(sessionUrlFromLocation(loc('/s/'))).toBeNull();
  });
});
