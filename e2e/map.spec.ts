import { expect, test, type Page } from '@playwright/test';
import {
  GEOMETRY_COLOURS,
  PLAYER,
  SPAWNS,
  instrumentStrokes,
  mockDaemon,
  strokeTally,
} from './fixtures/daemon';

// The map is a <canvas>, so there is no DOM to assert on for what it draws.
// These tests use two handles instead:
//
//   * the pixels themselves — a coarse signature over the backing store,
//     which answers "did the view change?" without pinning an exact image
//     (a screenshot baseline would flake on font and GPU differences)
//   * the DOM the canvas drives — the zoom readout in the View overlay, and
//     the hover tooltip, which only appears when a world→screen hit test
//     lands on a spawn
//
// Together they cover: geometry renders, zoom (wheel + slider + reset), pan,
// hit-testing, and selection crossing between the spawn list and the map.

type Signature = { hash: number; drawn: number; width: number; height: number };

// Coarse signature of the canvas backing store. Samples every 4th pixel — the
// map redraws on a rAF loop, and a full read of a DPR-scaled canvas on every
// poll is slow enough to matter. `drawn` counts pixels that differ from the
// background so "did anything render at all" is separable from "did the view
// change".
async function signature(page: Page): Promise<Signature> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    // The background is whatever the top-left corner is; the map never draws
    // into the extreme corner at rest.
    const bg = [data[0], data[1], data[2]];
    let hash = 0;
    let drawn = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r !== bg[0] || g !== bg[1] || b !== bg[2]) drawn++;
      hash = (hash * 31 + r + g * 3 + b * 7) | 0;
    }
    return { hash, drawn, width: c.width, height: c.height };
  });
}

// The map animates, so settle before sampling: take signatures until two in a
// row agree, then treat that as the resting frame.
async function restingSignature(page: Page): Promise<Signature> {
  let prev = await signature(page);
  for (let i = 0; i < 20; i++) {
    const next = await signature(page);
    if (next.hash === prev.hash && next.drawn === prev.drawn) return next;
    prev = next;
  }
  return prev;
}

const zoomReadout = (page: Page) => page.locator('label:has-text("Zoom") span.tabular-nums');
const canvas = (page: Page) => page.locator('canvas');

async function canvasCentre(page: Page) {
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

// "Track player" pins the player to the canvas centre, which is what makes the
// hit-test tests deterministic — otherwise the projection depends on the zone
// bounds fit and there is no fixed pixel to aim at.
async function enableTrackPlayer(page: Page) {
  await page.getByRole('menuitem', { name: 'Options' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Track player' }).click();
  await page.keyboard.press('Escape');
}

// The zone geometry starts drawing a frame or two after the snapshot lands
// (layer visibility is derived from the geometry in an effect). Every test
// settles on that first, so a "before" signature is never a pre-geometry
// frame — otherwise a later diff would prove only that the map finished
// loading, not that the interaction did anything.
async function waitForZoneDrawn(page: Page) {
  for (const colour of GEOMETRY_COLOURS) {
    await expect
      .poll(async () => (await strokeTally(page))[colour] ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(0);
  }
}

test.describe('Map canvas', () => {
  test.beforeEach(async ({ page }) => {
    await instrumentStrokes(page);
    await mockDaemon(page, { withPlayer: true, withGeometry: true });
    await page.goto('/');
    await expect(canvas(page)).toBeVisible();

    // Spawn-point markers pulse on a wallclock timer, so with them on the
    // canvas never truly rests and a pixel signature is only stable by luck.
    // None of these tests are about spawn points; turn the layer off so
    // "the view changed" means the interaction changed it.
    await page.getByRole('checkbox', { name: 'Spawn points' }).uncheck();

    await waitForZoneDrawn(page);
  });

  test('sizes its backing store to the container and draws the zone', async ({ page }) => {
    const sig = await restingSignature(page);

    // DPR-aware backing store, not a default 300x150 canvas.
    expect(sig.width).toBeGreaterThan(300);
    expect(sig.height).toBeGreaterThan(150);

    // Neither a pixel count nor a colour match would prove the zone drew:
    // an empty map already paints ~5k pixels of grid and chrome, and a 1px
    // antialiased line leaves almost no pixel at its pure colour. The draw
    // calls are exact — MapCanvas strokes each line in the colour that came
    // over the wire, so these two colours can only come from our fixture.
    const strokes = await strokeTally(page);
    for (const colour of GEOMETRY_COLOURS) {
      expect(strokes[colour] ?? 0, `no strokes in ${colour}: ${JSON.stringify(strokes)}`).toBeGreaterThan(0);
    }
    // The fallback colour means a line arrived with no colour of its own.
    expect(strokes['#4a6070'] ?? 0).toBe(0);
  });

  test('the wheel zooms, and reset view restores it', async ({ page }) => {
    await expect(zoomReadout(page)).toHaveText('1.00x');
    const before = await restingSignature(page);

    const { x, y } = await canvasCentre(page);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -300);

    await expect(zoomReadout(page)).not.toHaveText('1.00x');
    const zoomed = await restingSignature(page);
    expect(zoomed.hash).not.toBe(before.hash);

    await page.getByTitle('Reset zoom + pan').click();
    await expect(zoomReadout(page)).toHaveText('1.00x');
  });

  test('the zoom slider sets the scale', async ({ page }) => {
    await expect(zoomReadout(page)).toHaveText('1.00x');
    const before = await restingSignature(page);

    const slider = page.locator('label:has-text("Zoom") input[type="range"]');
    const max = await slider.getAttribute('max');
    await slider.fill(String(Math.floor(Number(max) / 2) + 2));

    await expect(zoomReadout(page)).not.toHaveText('1.00x');
    expect((await restingSignature(page)).hash).not.toBe(before.hash);
  });

  test('dragging pans the view, and reset view brings it back', async ({ page }) => {
    const before = await restingSignature(page);

    const { x, y } = await canvasCentre(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 120, y - 80, { steps: 12 });
    await page.mouse.up();

    const panned = await restingSignature(page);
    expect(panned.hash).not.toBe(before.hash);

    await page.getByTitle('Reset zoom + pan').click();
    await expect.poll(async () => (await restingSignature(page)).hash).toBe(before.hash);
  });

  test('hovering the player dot shows its tooltip, and leaving hides it', async ({ page }) => {
    await enableTrackPlayer(page);

    // Tracking pins the player to the centre, so that is where its dot is.
    const { x, y, box } = await canvasCentre(page);
    await page.mouse.move(x, y);

    const tip = page.getByText(PLAYER.name, { exact: false });
    await expect(tip.first()).toBeVisible();

    // Far corner: empty map, so the tooltip goes away.
    await page.mouse.move(box.x + 4, box.y + 4);
    await expect(page.locator('div.pointer-events-none.absolute.z-10')).toHaveCount(0);
  });

  test('hovering empty space shows no tooltip', async ({ page }) => {
    const { box } = await canvasCentre(page);
    await page.mouse.move(box.x + 3, box.y + box.height - 3);
    await expect(page.locator('div.pointer-events-none.absolute.z-10')).toHaveCount(0);
  });

  test('selecting a spawn in the list marks it on the map', async ({ page }) => {
    const spawns = page.locator('section', {
      has: page.locator('header span', { hasText: /^Spawns$/ }),
    });
    await spawns.locator('label:has-text("FPM") select').selectOption('60');

    const row = spawns.locator('tbody tr:has(td)').filter({ hasText: SPAWNS[0].name });
    await expect(row).toHaveCount(1);

    const before = await restingSignature(page);
    await row.click();

    // The selected spawn is drawn differently (ring/highlight), so the map
    // must repaint — this is the list → map half of selection.
    await expect(row).toHaveClass(/bg-primary/);
    await expect.poll(async () => (await restingSignature(page)).hash).not.toBe(before.hash);
  });
});
