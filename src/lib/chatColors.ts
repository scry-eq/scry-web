import { useEffect, useSyncExternalStore } from 'react';

// Single source of truth for chat colours. Two key spaces:
//   - "cc:<id>"  raw EQ ChatColor (CC_* in scry-cpp/src/everquest.h),
//                used for OP_FormattedMessage / SimpleMessage / SpecialMessage.
//   - "mt:<id>"  MessageType (MessageType in scry-cpp/src/message.h),
//                used as a fallback for OP_ChannelMessage lines (chatColor=0).
// Each entry has a single mid-saturation default hex that reads acceptably
// against both light and dark surfaces. Users can override any entry from
// the settings panel; overrides are stored in localStorage and applied as
// inline `style.color` in ChatLog so they win over the default.

export type ChatColorKey = `cc:${number}` | `mt:${number}`;

export type ChatColorEntry = {
  key: ChatColorKey;
  label: string;
  default: string;          // hex used when no override is set
  category: ChatColorCategory;
};

export type ChatColorCategory =
  | 'Channel fallback'
  | 'Player chat'
  | 'Custom channels'
  | 'Combat'
  | 'Spells'
  | 'System';

const mt = (id: number, label: string, hex: string,
            category: ChatColorCategory = 'Channel fallback'): ChatColorEntry =>
  ({ key: `mt:${id}`, label, default: hex, category });

const cc = (id: number, label: string, hex: string,
            category: ChatColorCategory): ChatColorEntry =>
  ({ key: `cc:${id}`, label, default: hex, category });

export const CHAT_COLOR_ENTRIES: ChatColorEntry[] = [
  // OP_ChannelMessage fallback (chatColor=0): MessageType lookup.
  mt(0,  'Guild',         '#22d3ee'),
  mt(2,  'Group',         '#06b6d4'),
  mt(3,  'Shout',         '#facc15'),
  mt(4,  'Auction',       '#f59e0b'),
  mt(5,  'OOC',           '#34d399'),
  mt(7,  'Tell',          '#f472b6'),
  mt(8,  'Say',           '#e5e7eb'),
  mt(11, 'GM Say',        '#e879f9'),
  mt(14, 'GM Tell',       '#e879f9'),
  mt(15, 'Raid',          '#fb7185'),

  // ChatColor space — server-coloured messages.
  cc(256, 'Say',                  '#e5e7eb', 'Player chat'),
  cc(257, 'Tell',                 '#f472b6', 'Player chat'),
  cc(258, 'Group',                '#06b6d4', 'Player chat'),
  cc(259, 'Guild',                '#22d3ee', 'Player chat'),
  cc(260, 'OOC',                  '#34d399', 'Player chat'),
  cc(261, 'Auction',              '#f59e0b', 'Player chat'),
  cc(262, 'Shout',                '#facc15', 'Player chat'),
  cc(263, 'Emote',                '#a78bfa', 'Player chat'),
  cc(307, 'Echo: Say',            '#cbd5e1', 'Player chat'),
  cc(308, 'Echo: Tell',           '#f9a8d4', 'Player chat'),
  cc(309, 'Echo: Group',          '#67e8f9', 'Player chat'),
  cc(310, 'Echo: Guild',          '#67e8f9', 'Player chat'),
  cc(311, 'Echo: OOC',            '#6ee7b7', 'Player chat'),
  cc(312, 'Echo: Auction',        '#fbbf24', 'Player chat'),
  cc(313, 'Echo: Shout',          '#fde047', 'Player chat'),
  cc(314, 'Echo: Emote',          '#c4b5fd', 'Player chat'),
  cc(327, 'Raid Say',             '#fb7185', 'Player chat'),

  cc(290, 'Chat Channel',         '#22d3ee', 'Custom channels'),
  cc(291, 'Channel 1',            '#67e8f9', 'Custom channels'),
  cc(292, 'Channel 2',            '#67e8f9', 'Custom channels'),
  cc(293, 'Channel 3',            '#67e8f9', 'Custom channels'),
  cc(294, 'Channel 4',            '#67e8f9', 'Custom channels'),
  cc(295, 'Channel 5',            '#67e8f9', 'Custom channels'),
  cc(296, 'Channel 6',            '#67e8f9', 'Custom channels'),
  cc(297, 'Channel 7',            '#67e8f9', 'Custom channels'),
  cc(298, 'Channel 8',            '#67e8f9', 'Custom channels'),
  cc(299, 'Channel 9',            '#67e8f9', 'Custom channels'),
  cc(300, 'Channel 10',           '#67e8f9', 'Custom channels'),
  cc(315, 'Echo: Channel 1',      '#a5f3fc', 'Custom channels'),
  cc(316, 'Echo: Channel 2',      '#a5f3fc', 'Custom channels'),
  cc(317, 'Echo: Channel 3',      '#a5f3fc', 'Custom channels'),
  cc(318, 'Echo: Channel 4',      '#a5f3fc', 'Custom channels'),
  cc(319, 'Echo: Channel 5',      '#a5f3fc', 'Custom channels'),
  cc(320, 'Echo: Channel 6',      '#a5f3fc', 'Custom channels'),
  cc(321, 'Echo: Channel 7',      '#a5f3fc', 'Custom channels'),
  cc(322, 'Echo: Channel 8',      '#a5f3fc', 'Custom channels'),
  cc(323, 'Echo: Channel 9',      '#a5f3fc', 'Custom channels'),
  cc(324, 'Echo: Channel 10',     '#a5f3fc', 'Custom channels'),

  cc(265, 'You hit other',        '#ef4444', 'Combat'),
  cc(266, 'Other hits you',       '#dc2626', 'Combat'),
  cc(267, 'You miss other',       '#9ca3af', 'Combat'),
  cc(268, 'Other misses you',     '#9ca3af', 'Combat'),
  cc(269, 'Duels',                '#fb923c', 'Combat'),
  cc(279, 'Other hits other',     '#9ca3af', 'Combat'),
  cc(280, 'Other misses other',   '#9ca3af', 'Combat'),
  cc(283, 'Non-melee',            '#fb923c', 'Combat'),
  cc(301, 'Melee crit',           '#f87171', 'Combat'),
  cc(304, 'NPC Rampage',          '#dc2626', 'Combat'),
  cc(305, 'NPC Furry',            '#dc2626', 'Combat'),
  cc(306, 'NPC Enrage',           '#dc2626', 'Combat'),
  cc(329, 'Damage shield',        '#fb923c', 'Combat'),

  cc(264, 'Spell',                '#38bdf8', 'Spells'),
  cc(284, 'Spell worn off',       '#7dd3fc', 'Spells'),
  cc(288, 'Other spells',         '#0ea5e9', 'Spells'),
  cc(289, 'Spell failure',        '#fb7185', 'Spells'),
  cc(302, 'Spell crit',           '#38bdf8', 'Spells'),

  cc(270, 'Skill',                '#9ca3af', 'System'),
  cc(271, 'Discipline',           '#9ca3af', 'System'),
  cc(273, 'Default',              '#e5e7eb', 'System'),
  cc(275, 'Merchant offer',       '#f59e0b', 'System'),
  cc(276, 'Merchant exchange',    '#f59e0b', 'System'),
  cc(277, 'Your death',           '#ef4444', 'System'),
  cc(278, 'Other death',          '#dc2626', 'System'),
  cc(281, 'Who',                  '#38bdf8', 'System'),
  cc(282, 'Yell',                 '#facc15', 'System'),
  cc(285, 'Money split',          '#f59e0b', 'System'),
  cc(286, 'Loot',                 '#f59e0b', 'System'),
  cc(287, 'Random',               '#38bdf8', 'System'),
  cc(303, 'Too far away',         '#9ca3af', 'System'),
  cc(325, 'DoT damage',           '#fb923c', 'Combat'),
  cc(326, 'Item tags',            '#fbbf24', 'System'),
  cc(328, 'My pet',               '#34d399', 'System'),
  cc(330, 'Leadership',           '#22d3ee', 'System'),
  cc(331, 'Pet flurry',           '#f87171', 'Combat'),
  cc(332, 'Pet critical',         '#f87171', 'Combat'),
  cc(333, 'Focus effect',         '#7dd3fc', 'Spells'),
  cc(334, 'XP',                   '#facc15', 'System'),
  cc(335, 'System',               '#e5e7eb', 'System'),
  cc(336, 'Pet spell',            '#38bdf8', 'Spells'),
  cc(337, 'Pet',                  '#34d399', 'System'),
  cc(338, 'Item speech',          '#fbbf24', 'System'),
  cc(339, 'Strikethrough',        '#fb923c', 'Combat'),
  cc(340, 'Stun',                 '#facc15', 'Combat'),
  cc(343, 'NPC',                  '#e5e7eb', 'System'),
  cc(382, 'Taunt failed',         '#9ca3af', 'Combat'),
  cc(389, 'Event',                '#facc15', 'System'),
];

// Lookup for ChatLog. Built once at module load.
const ENTRY_BY_KEY: Record<string, ChatColorEntry> = (() => {
  const m: Record<string, ChatColorEntry> = {};
  for (const e of CHAT_COLOR_ENTRIES) m[e.key] = e;
  return m;
})();

// Set of EQ ChatColor ids whose chat lines describe a combat outcome
// (hits, misses, resists, spell damage, procs, etc.). The CombatLog
// pulls these in alongside parsed CombatEvents because the daemon
// currently delivers spell-result lines purely as chat — see CombatLog
// comment for the daemon-side fix that would replace this scrape.
const COMBAT_CHAT_COLOR_IDS: ReadonlySet<number> = (() => {
  const s = new Set<number>();
  for (const e of CHAT_COLOR_ENTRIES) {
    if (e.category === 'Combat' || e.category === 'Spells') {
      const m = /^cc:(\d+)$/.exec(e.key);
      if (m) s.add(Number(m[1]));
    }
  }
  return s;
})();

export function isCombatChatColor(chatColor: number): boolean {
  return COMBAT_CHAT_COLOR_IDS.has(chatColor);
}

const STORAGE_KEY = 'scry.chatColorOverrides';

function readOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverrides(next: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // out of quota / private mode — ignore; the override won't persist
  }
  notify();
}

// Tiny pub-sub so React components stay in sync with localStorage edits.
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() { for (const l of listeners) l(); }
function subscribe(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function snapshot() { return cachedOverrides; }

let cachedOverrides: Record<string, string> = readOverrides();

// Cross-tab + cross-window sync via the storage event.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      cachedOverrides = readOverrides();
      notify();
    }
  });
}

export function setChatColorOverride(key: ChatColorKey, hex: string) {
  cachedOverrides = { ...cachedOverrides, [key]: hex };
  writeOverrides(cachedOverrides);
}

export function clearChatColorOverride(key: ChatColorKey) {
  if (!(key in cachedOverrides)) return;
  const next = { ...cachedOverrides };
  delete next[key];
  cachedOverrides = next;
  writeOverrides(cachedOverrides);
}

export function clearAllChatColorOverrides() {
  cachedOverrides = {};
  writeOverrides(cachedOverrides);
}

export function useChatColorOverrides(): Record<string, string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Compatibility shim: re-read on every mount (in case the cache was
// populated before localStorage was ready in some test envs).
export function useChatColorsReady() {
  useEffect(() => {
    const fresh = readOverrides();
    if (JSON.stringify(fresh) !== JSON.stringify(cachedOverrides)) {
      cachedOverrides = fresh;
      notify();
    }
  }, []);
}

// Resolve a ChatLog line's display label + colour. Prefers the wire
// ChatColor when nonzero, falls back to the MessageType channel.
export function resolveChatStyle(
  channel: number,
  chatColor: number,
  overrides: Record<string, string>,
): { label: string; color: string } {
  if (chatColor) {
    const e = ENTRY_BY_KEY[`cc:${chatColor}`];
    if (e) return { label: e.label, color: overrides[e.key] ?? e.default };
    return { label: `CC#${chatColor}`, color: overrides[`cc:${chatColor}`] ?? '#9ca3af' };
  }
  const e = ENTRY_BY_KEY[`mt:${channel}`];
  if (e) return { label: e.label, color: overrides[e.key] ?? e.default };
  return { label: `#${channel}`, color: overrides[`mt:${channel}`] ?? '#9ca3af' };
}
