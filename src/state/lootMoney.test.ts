import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  ChatMessageSchema,
  EnvelopeSchema,
  LootTransactionSchema,
} from '@gen/seq/v1/events_pb';
import { SpawnStore } from './store';

// chatColor 286 == CC_User_Loot, the colour loot lines arrive with.
const LOOT_COLOR = 286;

function chatEnvelope(seq: bigint, text: string, chatColor = LOOT_COLOR) {
  return create(EnvelopeSchema, {
    seq,
    payload: {
      case: 'chat',
      value: create(ChatMessageSchema, { text, chatColor }),
    },
  });
}

// The daemon reads the sale amount off the wire and publishes it here, rather
// than the client matching it out of the loot line's wording.
function lootTxnEnvelope(seq: bigint, coinCopper: number) {
  return create(EnvelopeSchema, {
    seq,
    payload: {
      case: 'lootTransaction',
      value: create(LootTransactionSchema, { coinCopper, corpseId: 11979 }),
    },
  });
}

// Verbatim lines from a live capture. The wording still states an amount; the
// client must take the item name from it and nothing else.
const SOLD_3G5S7C =
  "You looted a Cloth Shirt +2 from a skeletal excavator's corpse and sold it for 3 gold, 5 silver and 7 copper.";
const LOOTED_QTY =
  "--You have looted 2 Bone Chips from a cracked skeleton's corpse.--";

const ZERO = { platinum: 0, gold: 0, silver: 0, copper: 0 };

describe('auto-sell loot lines', () => {
  it('accrues coin from the loot transaction, not the text', () => {
    const store = new SpawnStore();
    store.apply(lootTxnEnvelope(1n, 7));
    expect(store.moneyTotal()).toEqual({ ...ZERO, copper: 7 });
  });

  it('splits a copper amount back across denominations', () => {
    const store = new SpawnStore();
    store.apply(lootTxnEnvelope(1n, 7));
    store.apply(lootTxnEnvelope(2n, 43));
    store.apply(lootTxnEnvelope(3n, 357));
    // 7c + (4s 3c) + (3g 5s 7c); denominations sum without carrying.
    expect(store.moneyTotal()).toEqual({
      platinum: 0,
      gold: 3,
      silver: 9,
      copper: 17,
    });
  });

  it('records the sold item in the loot log', () => {
    const store = new SpawnStore();
    store.apply(chatEnvelope(1n, SOLD_3G5S7C));
    expect(store.lootEntries().map((e) => e.itemName)).toEqual([
      'Cloth Shirt +2',
    ]);
  });

  it('handles a quantity-prefixed bordered loot line carrying no coin', () => {
    const store = new SpawnStore();
    store.apply(chatEnvelope(1n, LOOTED_QTY));
    expect(store.lootEntries().map((e) => e.itemName)).toEqual(['Bone Chips']);
    expect(store.moneyTotal()).toEqual(ZERO);
  });

  it('never accrues coin from the sale wording itself', () => {
    // The line still states an amount; the client must ignore it entirely.
    const store = new SpawnStore();
    store.apply(chatEnvelope(1n, SOLD_3G5S7C));
    expect(store.moneyTotal()).toEqual(ZERO);
  });

  it('ignores a coinless loot transaction', () => {
    // 6 of 24 confirmations in one capture carried no proceeds.
    const store = new SpawnStore();
    store.apply(lootTxnEnvelope(1n, 0));
    expect(store.moneyTotal()).toEqual(ZERO);
  });
});

// Verbatim lines from eqlegends-loot2 (2026-08-08); the two sales below are the
// ones whose wire amounts read 200 and 114.
const SOLD_2G =
  "You looted a Bronze Dagger +1 from a goblin diviner's corpse and sold it for 2 gold.";
const SOLD_1G1S4C =
  "You looted a Cloth Veil +1 from a goblin diviner's corpse and sold it for 1 gold, 1 silver and 4 copper.";
const DEPOT =
  "You looted 2 Bone Chips from a decaying skeleton's corpse and stored it in your tradeskill depot";
const HOARD =
  "You looted a Diamond Dust from an ice giant's corpse and stored it in your Dragon Hoard";
const CREATED =
  "You looted a Throwing Boulder from an ice giant diplomat's corpse to create a Throwing Boulder +8";

function corpseCoinEnvelope(seq: bigint, coinCopper: number) {
  return create(EnvelopeSchema, {
    seq,
    payload: {
      case: 'lootTransaction',
      value: create(LootTransactionSchema, { coinCopper, coinFromCorpse: true }),
    },
  });
}

describe('session loot window', () => {
  it('pairs a sale amount with the item it came from', () => {
    const store = new SpawnStore();
    store.apply(chatEnvelope(1n, SOLD_2G));
    store.apply(lootTxnEnvelope(2n, 200));
    store.apply(chatEnvelope(3n, SOLD_1G1S4C));
    store.apply(lootTxnEnvelope(4n, 114));
    expect(store.lootEntries().map((e) => [e.itemName, e.soldCopper])).toEqual([
      ['Bronze Dagger +1', 200],
      ['Cloth Veil +1', 114],
    ]);
  });

  it('does not pay a corpse pile to a pending sale', () => {
    // Corpse coin arrives at loot-window open, before the item lines.
    const store = new SpawnStore();
    store.apply(chatEnvelope(1n, SOLD_2G));
    store.apply(corpseCoinEnvelope(2n, 2881));
    store.apply(lootTxnEnvelope(3n, 200));
    expect(store.lootEntries()[0].soldCopper).toBe(200);
    // Both amounts still reach the purse: EQL auto-takes corpse coin.
    expect(store.moneyTotal()).toEqual({
      platinum: 2, gold: 10, silver: 8, copper: 1,
    });
  });

  it('leaves an unsold item with no sale amount', () => {
    const store = new SpawnStore();
    store.apply(chatEnvelope(1n, DEPOT));
    store.apply(corpseCoinEnvelope(2n, 62));
    expect(store.lootEntries()[0].soldCopper).toBeUndefined();
  });

  it('records where an unsold item went', () => {
    const store = new SpawnStore();
    store.apply(chatEnvelope(1n, DEPOT));
    store.apply(chatEnvelope(2n, HOARD));
    store.apply(chatEnvelope(3n, CREATED));
    expect(store.lootEntries().map((e) => [e.itemName, e.disposition, e.qty])).toEqual([
      ['Bone Chips', 'tradeskill depot', 2],
      ['Diamond Dust', 'Dragon Hoard', 1],
      ['Throwing Boulder', 'created', 1],
    ]);
  });
});
