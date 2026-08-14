import { expect, test, type Page } from '@playwright/test';

// These tests exercise the panel docking UI mechanics — the bits
// vitest can't cover (real pointer events, react-draggable behavior,
// flushSync handoff, snap-zone overlay). They run against a fresh
// browser context (no shared localStorage) so each test starts in
// the documented default layout.

const HEADER_DRAG_THRESHOLD_PX = 6;

async function openApp(page: Page) {
  await page.goto('/');
  // Vite first-load can be slow on cold start; wait for the Spawns
  // panel to render before each test starts asserting on it.
  await expect(page.locator('section', { has: page.locator('header span', { hasText: /^Spawns$/ }) })).toBeVisible();
}

function panelLocator(page: Page, title: string) {
  return page.locator('section', { has: page.locator('header span', { hasText: new RegExp(`^${title}$`) }) });
}

function floatingLocator(page: Page, fwId: string) {
  return page.locator(`[data-fw-id="${fwId}"]`);
}

test.describe('Panel detach + dock', () => {
  test('↗ button detaches a docked panel into a floating window in place', async ({ page }) => {
    await openApp(page);
    const spawns = panelLocator(page, 'Spawns');
    const dockedBox = await spawns.boundingBox();
    expect(dockedBox).not.toBeNull();

    await spawns.locator('header button[aria-label="Detach Spawns"]').click();

    const fw = floatingLocator(page, 'panel.spawns');
    await expect(fw).toBeVisible();
    const floatingBox = await fw.boundingBox();
    // In-place detach: floating origin should be near where the
    // docked panel was. Allow a few px of slop for borders / rounding.
    expect(Math.abs(floatingBox!.x - dockedBox!.x)).toBeLessThan(8);
    expect(Math.abs(floatingBox!.y - dockedBox!.y)).toBeLessThan(8);
  });

  test('↘ Dock button on a floating panel returns it to its origin rail', async ({ page }) => {
    await openApp(page);
    await panelLocator(page, 'Spawns').locator('header button[aria-label="Detach Spawns"]').click();
    const fw = floatingLocator(page, 'panel.spawns');
    await expect(fw).toBeVisible();
    await fw.locator('header button[aria-label="Dock window"]').click();
    await expect(fw).toBeHidden();
    await expect(panelLocator(page, 'Spawns')).toBeVisible();
  });
});

test.describe('Floating window mechanics', () => {
  test('header drag moves the floating window', async ({ page }) => {
    await openApp(page);
    await panelLocator(page, 'Spawns').locator('header button[aria-label="Detach Spawns"]').click();
    const fw = floatingLocator(page, 'panel.spawns');
    const before = await fw.boundingBox();

    // Drop into the center-map area (between rails) so the snap-zone
    // hit-test doesn't kick in and re-dock the panel mid-test.
    const viewport = page.viewportSize()!;
    const handle = fw.locator('header.fw-drag-handle');
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(handleBox.x + 50, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = await fw.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y)).toBeGreaterThan(100);
  });

  test('SE-corner grip resizes the floating window', async ({ page }) => {
    await openApp(page);
    await panelLocator(page, 'Spawns').locator('header button[aria-label="Detach Spawns"]').click();
    const fw = floatingLocator(page, 'panel.spawns');
    const before = await fw.boundingBox();

    // Grip is the absolutely-positioned aria-hidden div in the SE corner.
    const grip = fw.locator('div[aria-hidden]');
    const gripBox = (await grip.boundingBox())!;
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + 200, gripBox.y + 150, { steps: 10 });
    await page.mouse.up();

    const after = await fw.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 100);
    expect(after!.height).toBeGreaterThan(before!.height + 50);
  });
});

test.describe('Drag-out gesture', () => {
  test('header drag past threshold detaches and continues the drag in one motion', async ({ page }) => {
    await openApp(page);
    const spawns = panelLocator(page, 'Spawns');
    const header = spawns.locator('header');
    const headerBox = (await header.boundingBox())!;

    // Press in the middle of the header (away from the buttons), then
    // move > threshold so the gesture trips, then keep moving — the
    // floating window must be following the cursor without a release.
    const pressX = headerBox.x + headerBox.width / 3;
    const pressY = headerBox.y + headerBox.height / 2;
    const viewport = page.viewportSize()!;
    await page.mouse.move(pressX, pressY);
    await page.mouse.down();
    // Beyond the 6px threshold, in steps so undock + handoff fires.
    await page.mouse.move(pressX + HEADER_DRAG_THRESHOLD_PX + 4, pressY + 4, { steps: 3 });
    // Continue the drag into the center map area — without the
    // synthetic-mousedown handoff this would NOT update the floating
    // window's position. Center area also avoids snap-back to a rail.
    await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 10 });
    await page.mouse.up();

    const fw = floatingLocator(page, 'panel.spawns');
    await expect(fw).toBeVisible();
    const fwBox = (await fw.boundingBox())!;
    // Floating window moved with the drag, not stuck at in-place anchor.
    expect(fwBox.x).toBeGreaterThan(pressX + 100);
  });
});

test.describe('Snap-to-rail', () => {
  test('dragging a floating panel near the right edge snaps it into the right rail', async ({ page }) => {
    await openApp(page);
    await panelLocator(page, 'Spawns').locator('header button[aria-label="Detach Spawns"]').click();
    const fw = floatingLocator(page, 'panel.spawns');
    const handle = fw.locator('header.fw-drag-handle');
    const handleBox = (await handle.boundingBox())!;

    const viewport = page.viewportSize()!;
    await page.mouse.move(handleBox.x + 50, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.width - 100, 200, { steps: 12 });
    await page.mouse.up();

    // Re-docked → floating window gone, Spawns visible inside right rail.
    await expect(fw).toBeHidden();
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('scry.layout') ?? '{}'),
    );
    expect(stored.state.dockLocation.spawns).toBe('right');
  });

  test('dropping into a slot reorders the rail', async ({ page }) => {
    await openApp(page);
    // Detach Player and drop it at the very top of the right rail
    // (cursor near the top of the rail). Default order has Player at
    // slot 0 already, so target slot 2 (between Group and Chat) for
    // a meaningful reorder.
    await panelLocator(page, 'Player').locator('header button[aria-label="Detach Player"]').click();
    const fw = floatingLocator(page, 'panel.stats');
    const handle = fw.locator('header.fw-drag-handle');
    const handleBox = (await handle.boundingBox())!;

    // Drop midway down the right rail to land between two existing panels.
    const rightRail = page.locator('main > div > div').last();
    const railBox = (await rightRail.boundingBox())!;
    await page.mouse.move(handleBox.x + 50, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height * 0.6, { steps: 12 });
    await page.mouse.up();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('scry.layout') ?? '{}'),
    );
    // Player should NOT be at slot 0 anymore — was reordered to a
    // later slot.
    expect(stored.state.panelOrder.right[0]).not.toBe('stats');
    expect(stored.state.panelOrder.right).toContain('stats');
    expect(stored.state.dockLocation.stats).toBe('right');
  });
});

test.describe('View menu', () => {
  test('Lock panels hides the ↗ Detach button on every rail panel', async ({ page }) => {
    await openApp(page);
    // Programmatically flip the persisted flag and reload — exercises
    // the same render path the menu toggles, without depending on
    // Radix menu interaction details that aren't part of this feature.
    await page.evaluate(() => {
      const raw = localStorage.getItem('scry.layout');
      const blob = raw ? JSON.parse(raw) : { state: {}, version: 1 };
      blob.state.panelsLocked = true;
      localStorage.setItem('scry.layout', JSON.stringify(blob));
    });
    await page.reload();
    await expect(page.locator('section header button[aria-label^="Detach "]')).toHaveCount(0);
  });

  test('Reset layout restores defaults after a detach (via menu)', async ({ page }) => {
    await openApp(page);
    await panelLocator(page, 'Spawns').locator('header button[aria-label="Detach Spawns"]').click();
    await expect(floatingLocator(page, 'panel.spawns')).toBeVisible();

    // Drive the actual menu — confirms the wiring from MenubarItem
    // through the store action, not just the store action in
    // isolation (which the unit tests already cover).
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByText('Reset layout').click();

    await expect(floatingLocator(page, 'panel.spawns')).toBeHidden();
    await expect(panelLocator(page, 'Spawns')).toBeVisible();
  });
});

test.describe('Persistence', () => {
  test('a detached panel stays detached across reload', async ({ page }) => {
    await openApp(page);
    await panelLocator(page, 'Spawns').locator('header button[aria-label="Detach Spawns"]').click();
    await expect(floatingLocator(page, 'panel.spawns')).toBeVisible();
    await page.reload();
    await expect(floatingLocator(page, 'panel.spawns')).toBeVisible();
    await expect(panelLocator(page, 'Spawns').locator('header')).toBeHidden();
  });
});
