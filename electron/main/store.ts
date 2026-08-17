// Small on-disk settings for the shell. Deliberately not a dependency: this is one JSON
// file with one key, and a store library would be more surface than the thing it stores.

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { OverlayKind } from './kinds';

export type Bounds = { x: number; y: number; width: number; height: number };

const file = (): string => join(app.getPath('userData'), 'shell.json');

type Shape = { overlayBounds?: Partial<Record<OverlayKind, Bounds>> };

function read(): Shape {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Shape;
  } catch {
    // Absent on first run, and unreadable/corrupt is the same answer: use defaults rather
    // than fail to start over a settings file.
    return {};
  }
}

let pending: ReturnType<typeof setTimeout> | undefined;

function write(next: Shape): void {
  try {
    mkdirSync(dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(next, null, 2));
  } catch {
    // A window position is not worth surfacing an error for.
  }
}

export function readOverlayBounds(kind: OverlayKind): Bounds | null {
  const b = read().overlayBounds?.[kind];
  return valid(b) ? (b as Bounds) : null;
}

function put(kind: OverlayKind, b: Bounds): void {
  const cur = read();
  write({ ...cur, overlayBounds: { ...cur.overlayBounds, [kind]: b } });
}

/**
 * Debounced: 'moved' and 'resized' fire continuously through a drag, and this is a
 * settings file, not a telemetry stream. `flushOverlayBounds` covers the case where the
 * window closes inside the debounce window.
 */
export function saveOverlayBounds(kind: OverlayKind, b: Bounds): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    put(kind, b);
  }, 400);
}

export function flushOverlayBounds(kind: OverlayKind, b: Bounds): void {
  if (pending) {
    clearTimeout(pending);
    pending = undefined;
  }
  put(kind, b);
}
