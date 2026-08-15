import { expect, test, type Locator, type Page } from '@playwright/test';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  EnvelopeSchema,
  LootPageSchema,
  SnapshotSchema,
  SpawnPointSchema,
  SpawnSchema,
} from '../src/gen/seq/v1/events_pb';
import { ClientEnvelopeSchema } from '../src/gen/seq/v1/client_pb';

// The three TanStack tables — Spawns, Spawn Points and the Loot browser —
// driven by real seq.v1 frames over a mocked daemon socket, so sorting and
// resizing are exercised against actual rows. The panel suite renders these
// panels but never looks inside them.
//
// Fixtures are ordered so no column's sorted order matches the order the
// daemon sent them in: a table that ignored its sort state would otherwise
// pass. Levels and counts also straddle a decade boundary (3 vs 41 vs 55) so
// a lexical sort is distinguishable from a numeric one.

const SPAWNS = [
  { id: 1, name: 'Miragul', level: 55, class: 12, hpCur: 30, hpMax: 100 },
  { id: 2, name: 'a bat', level: 3, class: 1, hpCur: 100, hpMax: 100 },
  { id: 3, name: 'Zordak', level: 41, class: 9, hpCur: 70, hpMax: 100 },
  { id: 4, name: 'Cazic Thule', level: 70, class: 1, hpCur: 55, hpMax: 100 },
];

const POINTS = [
  { key: 'sp-c', name: 'orc pawn', x: 30, y: 30, z: 0, count: 7 },
  { key: 'sp-a', name: 'a griffon', x: 10, y: 10, z: 0, count: 21 },
  { key: 'sp-b', name: 'Vox', x: 20, y: 20, z: 0, count: 2 },
];

const LOOT = [
  { ts: 300n, itemName: 'Rusty Dagger', itemId: 11, qty: 3, mobName: 'a bat', zoneBase: 'qeynos' },
  { ts: 100n, itemName: 'Abacus', itemId: 33, qty: 5, mobName: 'Zordak', zoneBase: 'freeport' },
  { ts: 200n, itemName: 'Mithril Bar', itemId: 22, qty: 2, mobName: 'Vox', zoneBase: 'permafrost' },
];

function snapshotFrame(): Uint8Array {
  return toBinary(
    EnvelopeSchema,
    create(EnvelopeSchema, {
      seq: 1n,
      payload: {
        case: 'snapshot',
        value: create(SnapshotSchema, {
          sessionId: 'e2e',
          zoneShort: 'qeynos',
          zoneLong: 'South Qeynos',
          spawns: SPAWNS.map((s) =>
            create(SpawnSchema, { ...s, type: 1, pos: { x: 0, y: 0, z: 0 } }),
          ),
          spawnPoints: POINTS.map((p) => create(SpawnPointSchema, p)),
        }),
      },
    }),
  );
}

function lootFrame(): Uint8Array {
  return toBinary(
    EnvelopeSchema,
    create(EnvelopeSchema, {
      seq: 2n,
      payload: { case: 'lootPage', value: create(LootPageSchema, { rows: LOOT }) },
    }),
  );
}

// Both daemon sockets: the main stream answers Subscribe with a Snapshot,
// and /loot answers a LootQuery with a LootPage.
async function mockDaemon(page: Page) {
  await page.routeWebSocket(/localhost:9090/, (ws) => {
    const isLoot = new URL(ws.url()).pathname === '/loot';
    ws.onMessage((msg) => {
      const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : new Uint8Array(msg);
      const kind = fromBinary(ClientEnvelopeSchema, bytes).payload.case;
      if (!isLoot && kind === 'subscribe') ws.send(Buffer.from(snapshotFrame()));
      if (isLoot && kind === 'lootQuery') ws.send(Buffer.from(lootFrame()));
    });
  });
}

const panel = (page: Page, title: string) =>
  page.locator('section', { has: page.locator('header span', { hasText: new RegExp(`^${title}$`) }) });

// The tables are virtualized and pad with height-only <tr>s, so a row is only
// a row if it has cells.
const rowsOf = (table: Locator) => table.locator('tbody tr:has(td)');

// Column order is a rendering detail; find the index by header text so these
// assertions survive a column being inserted.
async function columnIndex(table: Locator, header: string): Promise<number> {
  const texts = await table.locator('thead th').allInnerTexts();
  const i = texts.findIndex((t) => t.trim().replace(/[▲▼]/g, '').trim() === header);
  expect(i, `no "${header}" header in [${texts.map((t) => t.trim())}]`).toBeGreaterThanOrEqual(0);
  return i;
}

async function columnValues(table: Locator, header: string): Promise<string[]> {
  const i = await columnIndex(table, header);
  return rowsOf(table).evaluateAll(
    (trs, idx) => trs.map((tr) => (tr.children[idx] as HTMLElement)?.innerText.trim() ?? ''),
    i,
  );
}

// Ascending or descending both count as sorted — the tables remember their
// last direction across a reload, so pinning one would be flaky.
function expectOrdered(values: string[], cmp: (a: string, b: string) => number) {
  const asc = [...values].sort(cmp);
  expect(
    values.join('|') === asc.join('|') || values.join('|') === [...asc].reverse().join('|'),
    `not sorted either way: ${values.join(', ')}`,
  ).toBe(true);
}

// The resize strip is the absolutely-positioned span inside the <th>.
async function dragGrip(page: Page, header: Locator, dx: number) {
  const grip = header.locator('span.cursor-col-resize');
  // The grip is a 1px strip on the column's right edge, which in a narrow rail
  // panel can sit outside the scroll viewport — mouse coords would then land on
  // whatever is actually there.
  await grip.scrollIntoViewIfNeeded();
  const box = (await grip.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 10 });
  await page.mouse.up();
}

const byText = (a: string, b: string) => a.localeCompare(b);
const byNumber = (a: string, b: string) => Number(a) - Number(b);

// v9 resolves sort fns by name through a registry. An unregistered name does
// not throw — it warns and silently sorts differently — so fail on it here
// rather than let a table quietly regress to a case-sensitive compare.
let complaints: string[] = [];

test.beforeEach(async ({ page }) => {
  complaints = [];
  page.on('console', (m) => {
    if (/is not registered|Warning:/.test(m.text())) complaints.push(m.text());
  });
  await mockDaemon(page);
  await page.goto('/');
});

test.afterEach(() => {
  expect(complaints, 'console complaints during the test').toEqual([]);
});

test.describe('Spawns table', () => {
  // The row memo recomputes on the panel's own FPM timer (10/min by default,
  // i.e. every 6s). Ask for the fastest rate so the tests aren't waiting on it.
  async function spawnsTable(page: Page): Promise<Locator> {
    const p = panel(page, 'Spawns');
    await p.locator('label:has-text("FPM") select').selectOption('60');
    const table = p.locator('table');
    await expect(rowsOf(table)).toHaveCount(SPAWNS.length);
    return table;
  }

  test('renders the spawns from the snapshot', async ({ page }) => {
    const table = await spawnsTable(page);
    await expect(table.getByText('Cazic Thule')).toBeVisible();
    expect(await columnValues(table, 'Name')).toHaveLength(SPAWNS.length);
  });

  test('clicking Name sorts, and clicking again reverses', async ({ page }) => {
    const table = await spawnsTable(page);
    const name = table.locator('thead th').filter({ hasText: 'Name' }).first();

    await name.locator('span.cursor-pointer').first().click();
    await expect(name).toContainText('▲');
    const asc = await columnValues(table, 'Name');
    expect(asc).toEqual([...asc].sort(byText));

    await name.locator('span.cursor-pointer').first().click();
    await expect(name).toContainText('▼');
    expect(await columnValues(table, 'Name')).toEqual([...asc].reverse());
  });

  test('sorting by Lvl is numeric, not lexical', async ({ page }) => {
    const table = await spawnsTable(page);
    const lvl = table.locator('thead th').filter({ hasText: 'Lvl' }).first();

    await lvl.locator('span.cursor-pointer').first().click();
    await expect(lvl).toContainText(/[▲▼]/);

    const levels = await columnValues(table, 'Lvl');
    expect(levels.map(Number).sort((a, b) => a - b)).toEqual([3, 41, 55, 70]);
    expectOrdered(levels, byNumber);
  });

  test('dragging a header grip resizes that column', async ({ page }) => {
    const table = await spawnsTable(page);
    const name = table.locator('thead th').filter({ hasText: 'Name' }).first();
    const before = (await name.boundingBox())!;

    await dragGrip(page, name, 60);

    expect((await name.boundingBox())!.width).toBeGreaterThan(before.width + 20);
  });
});

test.describe('Spawn Points table', () => {
  async function pointsTable(page: Page): Promise<Locator> {
    const table = panel(page, 'Spawn Points').locator('table');
    await expect(rowsOf(table)).toHaveCount(POINTS.length);
    return table;
  }

  test('renders the spawn points from the snapshot', async ({ page }) => {
    const table = await pointsTable(page);
    await expect(table.getByText('a griffon')).toBeVisible();
  });

  test('clicking Count sorts numerically', async ({ page }) => {
    const table = await pointsTable(page);
    const count = table.locator('thead th').filter({ hasText: 'Count' }).first();

    await count.locator('span.cursor-pointer').first().click();
    await expect(count).toContainText(/[▲▼]/);

    const counts = await columnValues(table, 'Count');
    expect(counts.map(Number).sort((a, b) => a - b)).toEqual([2, 7, 21]);
    expectOrdered(counts, byNumber);
  });

  test('dragging a header grip resizes that column', async ({ page }) => {
    const table = await pointsTable(page);
    const name = table.locator('thead th').filter({ hasText: 'Name' }).first();
    const before = (await name.boundingBox())!;

    await dragGrip(page, name, 50);

    expect((await name.boundingBox())!.width).toBeGreaterThan(before.width + 15);
  });
});

test.describe('Loot browser table', () => {
  // Scoped by a header only this table has — the rail panels keep their own
  // tables mounted behind the loot view.
  async function lootTable(page: Page): Promise<Locator> {
    await page.getByRole('button', { name: 'loot', exact: true }).click();
    const table = page.locator('table').filter({ has: page.locator('thead th', { hasText: 'Mob' }) });
    await expect(rowsOf(table)).toHaveCount(LOOT.length);
    return table;
  }

  test('renders the loot page', async ({ page }) => {
    const table = await lootTable(page);
    await expect(table.getByText('Mithril Bar')).toBeVisible();
    // Default sort is newest-first, so the fixture's ts=300 row leads.
    expect((await columnValues(table, 'Item'))[0]).toContain('Rusty Dagger');
  });

  test('clicking Item sorts by name', async ({ page }) => {
    const table = await lootTable(page);
    // The whole <th> is the sort target here, not an inner span.
    await table.locator('thead th').filter({ hasText: 'Item' }).first().click();
    expectOrdered(await columnValues(table, 'Item'), byText);
  });

  test('clicking Qty sorts numerically', async ({ page }) => {
    const table = await lootTable(page);
    await table.locator('thead th').filter({ hasText: 'Qty' }).first().click();

    const qty = await columnValues(table, 'Qty');
    expect(qty.map(Number).sort((a, b) => a - b)).toEqual([2, 3, 5]);
    expectOrdered(qty, byNumber);
  });
});
