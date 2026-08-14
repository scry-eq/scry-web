import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { Toaster } from 'sonner';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from '@/components/ui/menubar';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { ChatColorsPanel } from './ChatColorsPanel';
import { SeqClient } from '../net/client';
import { SpawnStore } from '../state/store';
import { BoxPicker } from './BoxPicker';
import { BuffsPanel } from './BuffsPanel';
import { TargetEffectsPanel } from './TargetEffectsPanel';
import { ChatLog } from './ChatLog';
import { CombatLog } from './CombatLog';
import { ExpLogPanel } from './ExpLogPanel';
import { LootHistoryPanel } from './LootHistoryPanel';
import { FilterRulesPanel } from './FilterRulesPanel';
import { GroupPanel } from './GroupPanel';
import { MapCanvas } from './MapCanvas';
import { LootBrowser } from './LootBrowser';
import { Panel } from './Panel';
import { PreferencesPanel } from './PreferencesPanel';
import { RailDivider, CollapsedRail } from './RailDivider';
import { SettingsModal } from './SettingsModal';
import { SpawnList } from './SpawnList';
import { SpawnInspectPanel } from './SpawnInspectPanel';
import { SpawnPointList } from './SpawnPointList';
import { PlayerPanel } from './PlayerPanel';
import { LootWindow } from './LootWindow';
import { AAWindow } from './AAWindow';
import { GuildWindow } from './GuildWindow';
import { SkillsWindow } from './SkillsWindow';
import { StatsWindow } from './StatsWindow';
import { TargetWindow } from './TargetWindow';
import { StatusBar } from './StatusBar';
import { InventoryStatsPanel } from './InventoryStatsPanel';
import { VerticalResizeHandle } from './VerticalResizeHandle';
import { FloatingWindow } from './FloatingWindow';
import { SnapZones, type SnapHint, type SnapSide } from './SnapZones';
import { useLayoutStore, type PanelKey } from '../state/layoutStore';
import { useBoxStore } from '../state/boxStore';
import { usePrefsStore } from '../state/prefsStore';
import { useSpawnFilterStore } from '../state/spawnFilterStore';
import { cueKeyForFilterFlags } from '../state/alertsStore';
import { playFilterCue } from '../lib/audioCue';
import { toastSpawnAlert } from '../lib/toastCue';
import { useBuffWarnings } from '../lib/useBuffWarnings';
import { useWakeLock } from '../lib/useWakeLock';
import { AlertsPanel } from './AlertsPanel';

type ConnStatus = 'disconnected' | 'connecting' | 'connected';

const STATUS_BADGE: Record<ConnStatus, string> = {
  connected:    'bg-emerald-700 text-emerald-100',
  connecting:   'bg-amber-700 text-amber-100',
  disconnected: 'bg-red-800 text-red-100',
};

// Match the page's scheme so an https-hosted UI doesn't trip mixed-content.
// Daemon is expected to run on the user's own machine, not the page origin.
const DEFAULT_WS_SCHEME = window.location.protocol === 'https:' ? 'wss' : 'ws';
const DEFAULT_URL = `${DEFAULT_WS_SCHEME}://localhost:9090`;
const URL_STORAGE_KEY = 'scry.daemonUrl';
const URL_HISTORY_KEY = 'scry.daemonUrlHistory';
// Cap the history at a small N — this is a "did the daemon move?"
// convenience picker, not a long-term log. The UI gets unwieldy past
// a dozen entries anyway.
const URL_HISTORY_MAX = 10;

function loadUrlHistory(): string[] {
  try {
    const raw = localStorage.getItem(URL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, URL_HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveUrlHistory(list: string[]): void {
  try { localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

const PANEL_DEFS: { key: PanelKey; label: string }[] = [
  { key: 'spawns',      label: 'Spawns'  },
  { key: 'spawnPoints', label: 'Points'  },
  { key: 'stats',       label: 'Player'  },
  { key: 'buffs',       label: 'Buffs'   },
  { key: 'targetEffects', label: 'Target' },
  { key: 'group',       label: 'Group'   },
  { key: 'chat',        label: 'Chat'    },
  { key: 'combat',      label: 'Combat'  },
  { key: 'expLog',      label: 'Exp Log' },
  { key: 'lootHistory', label: 'Loot Drops' },
];
// Default sizes used when a panel is first detached — chosen to match
// each panel's typical docked footprint so the in-place detach gesture
// feels natural even before the user has resized.
const PANEL_DEFAULT_SIZES: Record<PanelKey, { w: number; h: number }> = {
  spawns:      { w: 380, h: 480 },
  spawnPoints: { w: 380, h: 300 },
  stats:       { w: 320, h: 320 },
  buffs:       { w: 300, h: 240 },
  targetEffects: { w: 300, h: 240 },
  group:       { w: 280, h: 200 },
  combat:      { w: 380, h: 280 },
  chat:        { w: 380, h: 320 },
  expLog:      { w: 380, h: 320 },
  lootHistory: { w: 380, h: 320 },
};
// Title shown on detached panels — the View-menu label is too terse
// (e.g. "Points") for a window header.
const PANEL_TITLES: Record<PanelKey, string> = {
  spawns:      'Spawns',
  spawnPoints: 'Spawn Points',
  stats:       'Player',
  buffs:       'Buffs',
  targetEffects: 'Target Effects',
  group:       'Group',
  combat:      'Combat',
  chat:        'Chat',
  expLog:      'Exp Log',
  lootHistory: 'Loot History',
};
// Panels that prefer to fill remaining vertical space when docked, so
// the rail's natural-height panels (Player/Buffs/Group) sit at the top
// and these expand. Used for both rails when a panel of either type
// gets docked there.
const FLEX_GROW_PANELS = new Set<PanelKey>(['spawns', 'spawnPoints', 'combat', 'chat', 'expLog', 'lootHistory']);
const SNAP_THRESHOLD_PX = 32;


export function App() {
  const store = useMemo(() => new SpawnStore(), []);
  const [status, setStatus] = useState<ConnStatus>('disconnected');
  const [url, setUrl] = useState(() => localStorage.getItem(URL_STORAGE_KEY) || DEFAULT_URL);
  const [urlDraft, setUrlDraft] = useState(url);
  const [urlHistory, setUrlHistory] = useState<string[]>(loadUrlHistory);
  // Don't promote a URL to history until the WebSocket actually opens.
  // Tracks the previous status so we only fire on the rising edge of
  // a connect — disconnected/connecting → connected.
  const prevStatusRef = useRef<ConnStatus>(status);
  // Coarse tick so panels re-render even though the store mutates in
  // place. MapCanvas drives its own rAF loop independently.
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectVersion, setSelectVersion] = useState(0);
  const [panToXY, setPanToXY] = useState<{ x: number; y: number; v: number } | null>(null);
  const [inspectId, setInspectId] = useState<number | null>(null);
  // Panel layout state lives in the zustand store so unrelated
  // re-renders (e.g. tick churn) don't have to thread its setters
  // through every callback.
  const viewMode     = useLayoutStore((s) => s.viewMode);
  const setViewMode  = useLayoutStore((s) => s.setViewMode);
  const visibility   = useLayoutStore((s) => s.visibility);
  const dockLocation = useLayoutStore((s) => s.dockLocation);
  const panelOrder   = useLayoutStore((s) => s.panelOrder);
  const panelsLocked = useLayoutStore((s) => s.panelsLocked);
  const statusBarVisible = useLayoutStore((s) => s.statusBarVisible);
  const railWidths   = useLayoutStore((s) => s.railWidths);
  const leftSplit    = useLayoutStore((s) => s.leftSplit);
  const railCollapsed = useLayoutStore((s) => s.railCollapsed);
  const togglePanel       = useLayoutStore((s) => s.togglePanel);
  const hidePanel         = useLayoutStore((s) => s.hidePanel);
  const setPanelsLocked   = useLayoutStore((s) => s.setPanelsLocked);
  const setStatusBarVisible = useLayoutStore((s) => s.setStatusBarVisible);
  const setLeftRailWidth  = useLayoutStore((s) => s.setLeftRailWidth);
  const setRightRailWidth = useLayoutStore((s) => s.setRightRailWidth);
  const setLeftSplit      = useLayoutStore((s) => s.setLeftSplit);
  const toggleRailCollapsed = useLayoutStore((s) => s.toggleRailCollapsed);
  const setRailCollapsed    = useLayoutStore((s) => s.setRailCollapsed);
  const undock            = useLayoutStore((s) => s.undock);
  const dockToSlot        = useLayoutStore((s) => s.dockToSlot);
  const resetDockTo       = useLayoutStore((s) => s.resetDockTo);
  const resetLayout       = useLayoutStore((s) => s.resetLayout);

  const leftRailRef  = useRef<HTMLDivElement | null>(null);
  const rightRailRef = useRef<HTMLDivElement | null>(null);
  const [snapHint, setSnapHint] = useState<SnapHint | null>(null);
  // Which floating dock panel (if any) is currently being dragged.
  // Snap zones only appear during dock-panel drags; the 5 floating
  // utility windows (Loot, Skills, AA, StatsWindow, Inventory) don't
  // dock and don't pass these callbacks.
  const dragKeyRef = useRef<PanelKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [aaWindowOpen, setAAWindowOpen] = useState(false);
  const [guildWindowOpen, setGuildWindowOpen] = useState(false);
  const [statsWindowOpen, setStatsWindowOpen] = useState(false);
  const [targetWindowOpen, setTargetWindowOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [lootOpen, setLootOpen] = useState(false);
  const selectOnCon         = usePrefsStore((s) => s.selectOnConsider);
  const selectOnTarget      = usePrefsStore((s) => s.selectOnTarget);
  const deselectOnUntarget  = usePrefsStore((s) => s.deselectOnUntarget);
  const trackPlayer         = usePrefsStore((s) => s.trackPlayer);
  const smoothMovement      = usePrefsStore((s) => s.smoothMovement);
  const predictiveMovement  = usePrefsStore((s) => s.predictiveMovement);
  const updateSelectOnCon         = usePrefsStore((s) => s.setSelectOnConsider);
  const updateSelectOnTarget      = usePrefsStore((s) => s.setSelectOnTarget);
  const updateDeselectOnUntarget  = usePrefsStore((s) => s.setDeselectOnUntarget);
  const updateTrackPlayer         = usePrefsStore((s) => s.setTrackPlayer);
  const updateSmoothMovement      = usePrefsStore((s) => s.setSmoothMovement);
  const updatePredictiveMovement  = usePrefsStore((s) => s.setPredictiveMovement);
  // Live SeqClient for panels that need to send mutations back to the
  // daemon (e.g. FilterRulesPanel). Refreshed each time the URL changes.
  const clientRef = useRef<SeqClient | null>(null);

  useEffect(() => {
    // Coarse tick that drives re-render of panels reading from the
    // mutate-in-place SpawnStore. 1Hz is a deliberate trade: distance
    // columns / hp percentages refresh once a second instead of every
    // 250ms, but with hundreds of spawns in a busy zone the 4Hz cadence
    // pegged the React reconciler (TanStack Table reorders by distance,
    // which fires hundreds of <tbody> insertBefore mutations per tick).
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Promote the active URL to history on the rising edge of a connect.
  // Anything typed-but-never-opened stays out of the suggestions list.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status !== 'connected' || prev === 'connected') return;
    setUrlHistory((cur) => {
      const next = [url, ...cur.filter((u) => u !== url)].slice(0, URL_HISTORY_MAX);
      saveUrlHistory(next);
      return next;
    });
  }, [status, url]);

  // Buff-fade alert ticker. Runs whether or not the Buffs panel is
  // mounted — the daemon emits BuffsUpdate independent of UI state, so
  // pulling this into App keeps the cue audible even with the panel
  // hidden.
  useBuffWarnings(store);
  useWakeLock();

  // Keep the spawn-filter store's live player level in sync so the "±Me"
  // relative level band can resolve. Guarded so the 1Hz tick only writes
  // (and re-renders filter consumers) when the level actually changes.
  useEffect(() => {
    const lvl = store.stats()?.level ?? store.player()?.level ?? 0;
    if (lvl !== useSpawnFilterStore.getState().playerLevel) {
      useSpawnFilterStore.getState().setPlayerLevel(lvl);
    }
  }, [tick, store]);

  // Convert pixel-space drag delta into a fraction of the rail's
  // current height. Reading from the DOM avoids tracking a separate
  // resize observer for the rail container — its height is always
  // the parent flex row's full height minus the header.
  const onLeftSplitResize = useCallback((dy: number) => {
    const h = leftRailRef.current?.clientHeight ?? 0;
    if (h <= 0) return;
    setLeftSplit((prev) => prev + dy / h);
  }, [setLeftSplit]);

  // Snap-zone hit test. Edge proximity OR overlapping the actual rail
  // both count — the latter handles the case where a rail is currently
  // collapsed (no panels left) and the user wants to drop a panel back
  // onto the empty space where the rail would be. Returns the side AND
  // the slot index where the panel will land based on the cursor's
  // vertical position relative to the existing panels.
  const hitTest = useCallback((rect: DOMRect): SnapHint | null => {
    const vw = window.innerWidth;
    let side: SnapSide | null = null;
    if (rect.left  <= SNAP_THRESHOLD_PX)            side = 'left';
    else if (rect.right >= vw - SNAP_THRESHOLD_PX)  side = 'right';
    else {
      const lr = leftRailRef.current?.getBoundingClientRect();
      if (lr && rect.left <= lr.right + SNAP_THRESHOLD_PX && rect.left >= lr.left - SNAP_THRESHOLD_PX) {
        side = 'left';
      } else {
        const rr = rightRailRef.current?.getBoundingClientRect();
        if (rr && rect.right >= rr.left - SNAP_THRESHOLD_PX && rect.right <= rr.right + SNAP_THRESHOLD_PX) {
          side = 'right';
        }
      }
    }
    if (!side) return null;
    const railEl = side === 'left' ? leftRailRef.current : rightRailRef.current;
    const cursorY = rect.top + rect.height / 2;
    if (!railEl) return { side, slot: 0 };
    const sections = [...railEl.querySelectorAll<HTMLElement>(':scope > section')];
    let slot = sections.length;
    for (let i = 0; i < sections.length; i++) {
      const r = sections[i].getBoundingClientRect();
      if (cursorY < r.top + r.height / 2) { slot = i; break; }
    }
    return { side, slot };
  }, []);

  const onFloatingDragStart = useCallback((key: PanelKey, rect: DOMRect) => {
    dragKeyRef.current = key;
    setSnapHint(hitTest(rect));
  }, [hitTest]);
  const onFloatingDrag = useCallback((rect: DOMRect) => {
    setSnapHint(hitTest(rect));
  }, [hitTest]);
  const onFloatingDragEnd = useCallback((key: PanelKey, rect: DOMRect) => {
    const z = hitTest(rect);
    dragKeyRef.current = null;
    setSnapHint(null);
    if (z) {
      dockToSlot(key, z.side, z.slot);
      // Docking onto a collapsed rail should reveal it, else the panel
      // vanishes into a hidden rail.
      setRailCollapsed(z.side, false);
    }
  }, [dockToSlot, hitTest, setRailCollapsed]);

  // Drag-out gesture: detach when the user mouses down on the panel
  // header and moves > 6 px. Buttons in the header (close/detach) are
  // exempt so they still click normally. Once the threshold is crossed
  // we flip dockLocation to 'floating', seeding the FloatingWindow's
  // pos and size to the panel's current bounds so the pop-out appears
  // in place. Then — critical for one-shot drag UX — we hand the drag
  // off to the new FloatingWindow's react-draggable by synthesizing
  // a mousedown on its drag handle at the current cursor position.
  // Without that handoff the user has to release and re-click to start
  // dragging the floated panel, which feels broken.
  const makeHeaderDragHandler = (key: PanelKey) => (e: ReactPointerEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    const header = e.currentTarget;
    const panelEl = header.parentElement;
    if (!panelEl) return;
    const rect = panelEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dx * dx + dy * dy < 36) return;
      cleanup();
      // flushSync renders the FloatingWindow synchronously so the
      // synthetic mousedown fires in the same tick — no rAF gap during
      // which the cursor would drift, which on small panels (e.g. Buffs)
      // showed up as a visible jump when the drag picked up.
      flushSync(() => {
        undock(key, { x: rect.left, y: rect.top, w: rect.width, h: rect.height });
      });
      const fw = document.querySelector(`[data-fw-id="panel.${key}"] .fw-drag-handle`) as HTMLElement | null;
      if (!fw) return;
      fw.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: window,
        clientX: ev.clientX, clientY: ev.clientY, button: 0,
      }));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  // Explicit "↗" button: same as drag-out, but triggered by click.
  // Reads the panel rect at click time so the floating window spawns
  // exactly where the docked panel lived.
  const makeDetachClickHandler = (key: PanelKey) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const panelEl = e.currentTarget.closest('section') as HTMLElement | null;
    if (!panelEl) { undock(key); return; }
    const r = panelEl.getBoundingClientRect();
    undock(key, { x: r.left, y: r.top, w: r.width, h: r.height });
  };

  const onSelect = (id: number | null) => {
    setSelectedId(id);
    setSelectVersion((v) => v + 1);
  };

  const commitUrl = () => {
    const trimmed = urlDraft.trim();
    if (!trimmed || trimmed === url) { setUrlDraft(url); return; }
    localStorage.setItem(URL_STORAGE_KEY, trimmed);
    setUrl(trimmed);
  };

  useEffect(() => {
    setStatus('connecting');
    const client = new SeqClient(url);
    clientRef.current = client;
    const detachEnv = client.onEnvelope((env) => store.apply(env));
    // Drive UI selection from /consider and target packets when the
    // user opted in via PreferencesPanel.
    const detachSelect = client.onEnvelope((env) => {
      const p = env.payload;
      // Mirrors showeq-c interface.cpp:5035-5061: deselect-on-untarget
      // runs independently of select-on-target — clearing the target
      // can drop the current selection even with select-on-target off.
      // Read the store directly inside the closure so the latest toggle
      // value is used without re-subscribing on each change.
      const prefs = usePrefsStore.getState();
      if (p.case === 'considered' && p.value.spawnId && prefs.selectOnConsider) {
        onSelect(p.value.spawnId);
      } else if (p.case === 'targeted') {
        if (p.value.spawnId === 0) {
          if (prefs.deselectOnUntarget) onSelect(null);
        } else if (prefs.selectOnTarget) {
          onSelect(p.value.spawnId);
        }
      }
    });
    // Filter-flag-driven spawn alert sounds. `spawnAdded` is incremental
    // — the initial Snapshot's spawns don't pass through here, so a
    // fresh connect doesn't fire 200 cues at once. Snapshots after a
    // mid-session reconnect skip the cues for the same reason.
    const detachAlert = client.onEnvelope((env) => {
      const p = env.payload;
      if (p.case !== 'spawnAdded' || !p.value.spawn) return;
      const cue = cueKeyForFilterFlags(p.value.spawn.filterFlags);
      if (cue) {
        playFilterCue(cue);
        toastSpawnAlert(p.value.spawn.name, cue, p.value.spawn.id);
      }
    });
    // Multibox: daemon broadcasts BoxListUpdated as its BoxRegistry
    // changes (Stage 4 of ../scry-cpp/docs/MULTIBOX_PLAN.md).
    // Mirror into useBoxStore so the header picker renders.
    const detachBoxes = client.onEnvelope((env) => {
      const p = env.payload;
      if (p.case !== 'boxListUpdated') return;
      useBoxStore.getState().setBoxes(
        p.value.boxes.map((b) => ({
          boxId:       b.boxId,
          displayName: b.displayName,
          clientIp:    b.clientIp,
          packetCount: b.packetCount,
          zone:        b.zone,
          level:       b.level,
        })),
        p.value.activeBoxId,
      );
    });
    // Tauri desktop: record loot in-app off this same envelope stream (the
    // packaged app has no standalone Bun recorder). No-ops in the browser build.
    // The sink DB is chosen per backend from the first Snapshot's data namespace.

    const ws = { detach: () => { client.close(); detachEnv(); detachSelect(); detachAlert(); detachBoxes(); } };

    const poll = setInterval(() => {
      const w = (client as unknown as { ws?: WebSocket }).ws;
      if (!w) return;
      switch (w.readyState) {
        case WebSocket.CONNECTING: setStatus('connecting'); break;
        case WebSocket.OPEN:       setStatus('connected');  break;
        default:                   setStatus('disconnected');
      }
    }, 500);

    client.connect();
    // Request the map-package list so the MapCanvas picker populates
    // promptly. The daemon also pushes a MapPackagesUpdate on subscribe,
    // but mirroring the devices-style request keeps parity and covers a
    // resume/replay that skips the initial Snapshot. The send no-ops
    // until the socket is open; the on-subscribe push covers that window.
    client.listMapPackages();
    return () => {
      clearInterval(poll);
      ws.detach();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [store, url]);

  // A panel only contributes to its rail when both visible AND docked
  // there. Detached ('floating') panels are rendered separately below.
  const isDocked = (k: PanelKey, side: 'left' | 'right') =>
    visibility[k] && dockLocation[k] === side;
  const leftPanels  = panelOrder.left.filter((k) => isDocked(k, 'left'));
  const rightPanels = panelOrder.right.filter((k) => isDocked(k, 'right'));
  const leftHasPanels  = leftPanels.length > 0;
  const rightHasPanels = rightPanels.length > 0;
  const showLeftRail  = leftHasPanels  && !railCollapsed.left;
  const showRightRail = rightHasPanels && !railCollapsed.right;
  // The Spawns/SpawnPoints split survives only as long as those are the
  // only two left-rail panels — otherwise leftSplit isn't meaningful.
  const useLeftSplit =
    leftPanels.length === 2 &&
    leftPanels.includes('spawns') &&
    leftPanels.includes('spawnPoints');

  // Body content for each panel, reused for docked + floating render.
  // Co-located here so both branches stay in sync as panel props evolve.
  const renderPanelBody = (key: PanelKey): ReactNode => {
    switch (key) {
      case 'spawns':
        return <SpawnList store={store} selectedId={selectedId} onSelect={onSelect} onInspect={setInspectId} />;
      case 'spawnPoints':
        return <SpawnPointList store={store} tick={tick} client={clientRef.current}
          onPanTo={(x, y) => setPanToXY((prev) => ({ x, y, v: (prev?.v ?? 0) + 1 }))}
        />;
      case 'stats':
        return (
          <PlayerPanel
            store={store}
            tick={tick}
            onOpenSkills={() => setSkillsOpen((v) => !v)}
            onOpenStats={() => setStatsWindowOpen((v) => !v)}
            onOpenAA={() => setAAWindowOpen((v) => !v)}
            onOpenGuild={() => setGuildWindowOpen((v) => !v)}
            onOpenLoot={() => setLootOpen((v) => !v)}
            onOpenItems={() => setInventoryOpen((v) => !v)}
          />
        );
      case 'buffs':
        return <BuffsPanel store={store} tick={tick} />;
      case 'targetEffects':
        return <TargetEffectsPanel store={store} tick={tick} spawnId={selectedId} />;
      case 'group':
        return <GroupPanel store={store} tick={tick} />;
      case 'combat':
        return <CombatLog store={store} tick={tick} />;
      case 'expLog':
        return <ExpLogPanel store={store} tick={tick} />;
      case 'chat':
        return <ChatLog store={store} tick={tick} />;
      case 'lootHistory':
        return <LootHistoryPanel store={store} tick={tick} />;
    }
  };

  return (
    <main className="flex h-screen w-screen flex-col bg-bg-base text-foreground">
      <Toaster theme="dark" richColors position="top-right" closeButton />

      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-bg-panel px-3 py-2">
        <h1 className="m-0 text-base font-semibold">Scry</h1>
        <input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onBlur={commitUrl}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.currentTarget.blur(); }
            else if (e.key === 'Escape') { setUrlDraft(url); e.currentTarget.blur(); }
          }}
          list="scry-cpp-url-history"
          spellCheck={false}
          className="w-80 rounded border border-border bg-bg-base px-2 py-1 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
        />
        <datalist id="scry-cpp-url-history">
          {urlHistory.map((u) => <option key={u} value={u} />)}
        </datalist>
        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[status]}`}>
          {status}
        </span>
        <BoxPicker
          onChange={(boxId) => clientRef.current?.setActiveBox(boxId)}
        />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-6 overflow-hidden rounded border border-border">
            {(['map', 'loot'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`px-2 text-xs font-medium capitalize select-none ${
                  viewMode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-bg-alt text-muted-foreground hover:text-foreground'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <Menubar className="h-6">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex items-center bg-primary px-2 text-xs font-medium text-primary-foreground select-none hover:bg-primary/90 focus:bg-primary focus:text-primary-foreground focus:outline-none"
            >
              Filters
            </button>
            <MenubarSeparator className="mx-0 my-0 h-auto w-px self-stretch" />
            <MenubarMenu>
              <MenubarTrigger
                className="bg-primary text-primary-foreground text-xs hover:bg-primary/90 focus:bg-primary focus:text-primary-foreground data-[state=open]:bg-primary/90 data-[state=open]:text-primary-foreground"
              >
                View
              </MenubarTrigger>
              <MenubarContent>
                {PANEL_DEFS.map((p) => (
                  <MenubarCheckboxItem
                    key={p.key}
                    checked={visibility[p.key]}
                    onCheckedChange={() => togglePanel(p.key)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {p.label}
                  </MenubarCheckboxItem>
                ))}
                <MenubarCheckboxItem
                  checked={targetWindowOpen}
                  onCheckedChange={() => setTargetWindowOpen((v) => !v)}
                  onSelect={(e) => e.preventDefault()}
                >
                  Target Window
                </MenubarCheckboxItem>
                <MenubarSeparator />
                <MenubarCheckboxItem
                  checked={statusBarVisible}
                  onCheckedChange={setStatusBarVisible}
                  onSelect={(e) => e.preventDefault()}
                >
                  Status bar
                </MenubarCheckboxItem>
                <MenubarCheckboxItem
                  checked={panelsLocked}
                  onCheckedChange={setPanelsLocked}
                  onSelect={(e) => e.preventDefault()}
                >
                  Lock panels
                </MenubarCheckboxItem>
                <MenubarItem onClick={resetLayout}>Reset layout</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarSeparator className="mx-0 my-0 h-auto w-px self-stretch" />
            <MenubarMenu>
              <MenubarTrigger
                className="bg-primary text-primary-foreground text-xs hover:bg-primary/90 focus:bg-primary focus:text-primary-foreground data-[state=open]:bg-primary/90 data-[state=open]:text-primary-foreground"
              >
                Options
              </MenubarTrigger>
              <MenubarContent>
                <MenubarCheckboxItem
                  checked={selectOnTarget}
                  onCheckedChange={updateSelectOnTarget}
                  onSelect={(e) => e.preventDefault()}
                >
                  Select on target
                </MenubarCheckboxItem>
                <MenubarCheckboxItem
                  checked={selectOnCon}
                  onCheckedChange={updateSelectOnCon}
                  onSelect={(e) => e.preventDefault()}
                >
                  Select on consider
                </MenubarCheckboxItem>
                <MenubarCheckboxItem
                  checked={deselectOnUntarget}
                  onCheckedChange={updateDeselectOnUntarget}
                  onSelect={(e) => e.preventDefault()}
                >
                  Deselect on untarget
                </MenubarCheckboxItem>
                <MenubarCheckboxItem
                  checked={trackPlayer}
                  onCheckedChange={updateTrackPlayer}
                  onSelect={(e) => e.preventDefault()}
                >
                  Track player
                </MenubarCheckboxItem>
                <MenubarCheckboxItem
                  checked={smoothMovement}
                  onCheckedChange={updateSmoothMovement}
                  onSelect={(e) => e.preventDefault()}
                >
                  Smooth movement
                </MenubarCheckboxItem>
                <MenubarCheckboxItem
                  checked={predictiveMovement}
                  onCheckedChange={updatePredictiveMovement}
                  onSelect={(e) => e.preventDefault()}
                  disabled={!smoothMovement}
                >
                  Predictive (velocity)
                </MenubarCheckboxItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            title="Settings"
            className="rounded px-2 py-0.5 text-base leading-none text-muted-foreground hover:bg-bg-base hover:text-foreground"
          >
            ⚙
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {showLeftRail && (
          <>
            <div
              ref={leftRailRef}
              className="flex shrink-0 flex-col"
              style={{ width: `${railWidths.left}px` }}
            >
              {leftPanels.flatMap((k) => {
                const flexStyle = useLeftSplit
                  ? { flex: `${k === 'spawns' ? leftSplit : 1 - leftSplit} 1 0%` }
                  : FLEX_GROW_PANELS.has(k)
                  ? { flex: '1 1 0%' }
                  : undefined;
                const nodes = [
                  <Panel
                    key={k}
                    title={PANEL_TITLES[k]}
                    onClose={() => hidePanel(k)}
                    onDetach={panelsLocked ? undefined : makeDetachClickHandler(k)}
                    onHeaderPointerDown={panelsLocked ? undefined : makeHeaderDragHandler(k)}
                    className={FLEX_GROW_PANELS.has(k) || useLeftSplit ? 'min-h-0' : ''}
                    style={flexStyle}
                  >
                    {renderPanelBody(k)}
                  </Panel>,
                ];
                if (useLeftSplit && k === 'spawns') {
                  nodes.push(
                    <VerticalResizeHandle key={`${k}-split`} onDrag={onLeftSplitResize} />,
                  );
                }
                return nodes;
              })}
            </div>
            <RailDivider
              side="left"
              onResize={setLeftRailWidth}
              onCollapse={() => toggleRailCollapsed('left')}
            />
          </>
        )}
        {!showLeftRail && leftHasPanels && (
          <CollapsedRail
            side="left"
            labels={leftPanels.map((k) => PANEL_TITLES[k])}
            onExpand={() => toggleRailCollapsed('left')}
          />
        )}
        <div className="min-w-[300px] flex-1">
          {viewMode === 'loot' ? (
            <LootBrowser daemonUrl={url} />
          ) : (
            <MapCanvas
              store={store}
              client={clientRef.current}
              tick={tick}
              selectedId={selectedId}
              selectVersion={selectVersion}
              onSelect={onSelect}
              trackPlayer={trackPlayer}
              smoothMovement={smoothMovement}
              predictiveMovement={predictiveMovement}
              panToXY={panToXY}
            />
          )}
        </div>
        {!showRightRail && rightHasPanels && (
          <CollapsedRail
            side="right"
            labels={rightPanels.map((k) => PANEL_TITLES[k])}
            onExpand={() => toggleRailCollapsed('right')}
          />
        )}
        {showRightRail && (
          <>
            <RailDivider
              side="right"
              onResize={setRightRailWidth}
              onCollapse={() => toggleRailCollapsed('right')}
            />
            <div
              ref={rightRailRef}
              className="flex shrink-0 flex-col"
              style={{ width: `${railWidths.right}px` }}
            >
              {rightPanels.map((k) => (
                <Panel
                  key={k}
                  title={PANEL_TITLES[k]}
                  onClose={() => hidePanel(k)}
                  onDetach={panelsLocked ? undefined : makeDetachClickHandler(k)}
                  onHeaderPointerDown={panelsLocked ? undefined : makeHeaderDragHandler(k)}
                  className={FLEX_GROW_PANELS.has(k) ? 'min-h-0 flex-1' : ''}
                >
                  {renderPanelBody(k)}
                </Panel>
              ))}
            </div>
          </>
        )}
      </div>
      {statusBarVisible && <StatusBar store={store} client={clientRef.current} tick={tick} />}
      {skillsOpen && (
        <SkillsWindow
          store={store}
          tick={tick}
          onClose={() => setSkillsOpen(false)}
        />
      )}
      {aaWindowOpen && (
        <AAWindow
          store={store}
          tick={tick}
          onClose={() => setAAWindowOpen(false)}
        />
      )}
      {guildWindowOpen && (
        <GuildWindow
          store={store}
          tick={tick}
          onClose={() => setGuildWindowOpen(false)}
        />
      )}
      {statsWindowOpen && (
        <StatsWindow
          store={store}
          tick={tick}
          onClose={() => setStatsWindowOpen(false)}
        />
      )}
      {targetWindowOpen && (
        <TargetWindow
          store={store}
          tick={tick}
          spawnId={selectedId}
        />
      )}
      {inventoryOpen && (
        <InventoryStatsPanel
          store={store}
          tick={tick}
          onClose={() => setInventoryOpen(false)}
        />
      )}
      {lootOpen && (
        <LootWindow
          store={store}
          tick={tick}
          onClose={() => setLootOpen(false)}
        />
      )}
      {(['spawns','spawnPoints','stats','buffs','targetEffects','group','combat','chat','expLog','lootHistory'] as PanelKey[])
        .filter((k) => visibility[k] && dockLocation[k] === 'floating')
        .map((k) => (
          <FloatingWindow
            key={k}
            id={`panel.${k}`}
            title={PANEL_TITLES[k]}
            defaultSize={PANEL_DEFAULT_SIZES[k]}
            onClose={() => hidePanel(k)}
            onDock={panelsLocked ? undefined : () => resetDockTo(k)}
            onDragStart={panelsLocked ? undefined : (r) => onFloatingDragStart(k, r)}
            onDrag={panelsLocked ? undefined : onFloatingDrag}
            onDragEnd={panelsLocked ? undefined : (r) => onFloatingDragEnd(k, r)}
          >
            {renderPanelBody(k)}
          </FloatingWindow>
        ))}
      {inspectId !== null && (
        <SpawnInspectPanel
          spawnId={inspectId}
          store={store}
          tick={tick}
          onClose={() => setInspectId(null)}
        />
      )}
      {snapHint !== null && (
        <SnapZones
          leftRailRef={leftRailRef}
          rightRailRef={rightRailRef}
          hint={snapHint}
        />
      )}
      <SettingsModal
        open={settingsOpen}
        title="Settings"
        onClose={() => setSettingsOpen(false)}
      >
        <Tabs defaultValue="preferences" className="gap-0">
          <TabsList className="sticky top-0 z-10 m-3 self-start bg-bg-panel">
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="chat-colors">Chat Colors</TabsTrigger>
          </TabsList>
          <TabsContent value="preferences">
            <PreferencesPanel
              store={store}
              client={clientRef.current}
              tick={tick}
            />
          </TabsContent>
          <TabsContent value="alerts">
            <AlertsPanel />
          </TabsContent>
          <TabsContent value="chat-colors">
            <ChatColorsPanel />
          </TabsContent>
        </Tabs>
      </SettingsModal>
      <SettingsModal
        open={filtersOpen}
        title="Filters"
        onClose={() => setFiltersOpen(false)}
      >
        {clientRef.current ? (
          <FilterRulesPanel
            store={store}
            client={clientRef.current}
            tick={tick}
          />
        ) : (
          <div className="px-4 py-6 text-xs text-muted-foreground">Connecting…</div>
        )}
      </SettingsModal>
    </main>
  );
}
