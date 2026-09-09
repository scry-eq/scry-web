import { describe, it, expect } from 'vitest';
import { parseEqlLootMessage, parseMoneyToCopper, normalizeMob, splitZoneInstance } from './lootParse';

// All strings below are verbatim distinct color-286 lines from the committed
// eql-fighting fixture (see the enumeration used to derive the two families).
describe('parseEqlLootMessage', () => {
  it('parses Family A — bordered "kept to inventory"', () => {
    expect(parseEqlLootMessage("--You have looted a Dragon Bone Bracelet from Lady Vox's corpse.--"))
      .toEqual({ item: 'Dragon Bone Bracelet', qty: 1, mob: 'Lady Vox', sold: false, disposition: 'inventory', moneyCopper: 0 });
    expect(parseEqlLootMessage("--You have looted an Imbued Granite Spaulders +1 from Commander Yarik's corpse.--"))
      .toMatchObject({ item: 'Imbued Granite Spaulders +1', mob: 'Commander Yarik', disposition: 'inventory' });
  });

  it('parses Family B — auto-store, capturing the destination', () => {
    expect(parseEqlLootMessage(
      "You looted a Drop of Mercury from an elemental channeler's corpse and stored it in your tradeskill depot"))
      .toEqual({ item: 'Drop of Mercury', qty: 1, mob: 'an elemental channeler', sold: false, disposition: 'tradeskill depot', moneyCopper: 0 });
    expect(parseEqlLootMessage(
      "You looted a Mote of Minor Potential from an icy terror's corpse and stored it in your currency"))
      .toMatchObject({ mob: 'an icy terror', disposition: 'currency' });
  });

  it('parses Family B — auto-sell, parsing the coin amount', () => {
    expect(parseEqlLootMessage(
      "You looted a Cracked Paineel Shield from a wanderer's corpse and sold it for 20 platinum."))
      .toEqual({ item: 'Cracked Paineel Shield', qty: 1, mob: 'a wanderer', sold: true, disposition: 'sold', moneyCopper: 20000 });
    expect(parseEqlLootMessage(
      "You looted a Fine Steel Great Staff +2 from a priest of Nagafen's corpse and sold it for 4 platinum, 6 gold, 4 silver and 3 copper."))
      .toMatchObject({ mob: 'a priest of Nagafen', sold: true, moneyCopper: 4643 });
  });

  it('parses Family B — auto-upgrade "to create"', () => {
    expect(parseEqlLootMessage(
      "You looted a McVaxius` Horn of War from Lady Vox's corpse to create a McVaxius` Horn of War +1"))
      .toMatchObject({ item: 'McVaxius` Horn of War', mob: 'Lady Vox', disposition: 'created' });
  });

  it('ignores the "no loot" notice and other 286 noise', () => {
    expect(parseEqlLootMessage('You receive no loot for defeating this creature as you are in a raid.')).toBeNull();
    expect(parseEqlLootMessage('You have entered the Plane of Fear.')).toBeNull();
  });
});

describe('parseMoneyToCopper', () => {
  it('sums coin tokens to copper', () => {
    expect(parseMoneyToCopper('20 platinum')).toBe(20000);
    expect(parseMoneyToCopper('4 platinum, 6 gold, 4 silver and 3 copper')).toBe(4643);
    expect(parseMoneyToCopper('1 silver and 4 copper')).toBe(14);
  });
});

describe('normalizeMob', () => {
  it('strips leading article + lowercases', () => {
    expect(normalizeMob('an elemental channeler')).toBe('elemental channeler');
    expect(normalizeMob('A Rock Golem')).toBe('rock golem');
    expect(normalizeMob('the Ancient')).toBe('ancient');
  });

  it("strips a trailing corpse suffix", () => {
    expect(normalizeMob("a rock golem's corpse")).toBe('rock golem');
    expect(normalizeMob('an orc pawn corpse')).toBe('orc pawn');
  });
});

describe('splitZoneInstance', () => {
  it('splits the eql instance suffix', () => {
    expect(splitZoneInstance('permafrost_multi')).toEqual({ base: 'permafrost', instance: 'multi' });
    expect(splitZoneInstance('nagafen_solo')).toEqual({ base: 'nagafen', instance: 'solo' });
    expect(splitZoneInstance('veeshan_eqlraidgroup')).toEqual({ base: 'veeshan', instance: 'eqlraidgroup' });
  });

  it('leaves a plain zone alone', () => {
    expect(splitZoneInstance('permafrost')).toEqual({ base: 'permafrost', instance: '' });
  });
});
