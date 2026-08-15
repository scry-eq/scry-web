import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  AddFilterRuleSchema,
  ClientEnvelopeSchema,
  EditFilterRuleSchema,
  ListDevicesSchema,
  ListMapPackagesSchema,
  ReloadFiltersSchema,
  RemoveFilterRuleSchema,
  RenameSpawnPointSchema,
  SaveFiltersSchema,
  SetActiveBoxSchema,
  SetMapPackageSchema,
  SetPrefSchema,
  SubscribeSchema,
  Topic,
} from '@gen/seq/v1/client_pb';
import {
  EnvelopeSchema,
  PrefSchema,
  type Envelope,
} from '@gen/seq/v1/events_pb';

export type EnvelopeListener = (env: Envelope) => void;

// Minimal WebSocket client that speaks seq.v1 protobuf. Connects, sends a
// Subscribe on open, and fans out incoming Envelope messages to listeners.
// Reconnects with exponential backoff on disconnect — the daemon may be
// restarted during capture sessions.
//
// Resume: the daemon assigns a session_id on first Subscribe and includes
// it in the Snapshot envelope. We hold it (and the high-water-mark seq)
// in memory; if the WebSocket drops we reconnect with both fields set so
// the daemon replays anything it buffered while we were gone instead of
// rebuilding from a fresh Snapshot. Both reset on `close()` / page reload
// — fresh page = fresh session.
export class SeqClient {
  private ws?: WebSocket;
  private listeners = new Set<EnvelopeListener>();
  private backoffMs = 250;
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;
  private sessionId = '';
  private lastSeq = 0n;

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      // Constructor throws synchronously on a malformed URL or on
      // mixed-content (e.g. ws:// from an https page). Catch so the
      // React tree doesn't unmount; reconnect will keep retrying and
      // pick up a new URL once the user fixes it in Settings.
      ws = new WebSocket(this.url);
    } catch (err) {
      console.warn('WebSocket construction failed', err);
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.backoffMs = 250;
      if (this.retry !== undefined) { clearTimeout(this.retry); this.retry = undefined; }
      const env = create(ClientEnvelopeSchema, {
        payload: {
          case: 'subscribe',
          value: create(SubscribeSchema, {
            topics: [Topic.SPAWNS, Topic.ZONE, Topic.PLAYER],
            sessionId: this.sessionId,
            lastSeq: this.lastSeq,
          }),
        },
      });
      ws.send(toBinary(ClientEnvelopeSchema, env));
    };

    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(ev.data);
      try {
        const env = fromBinary(EnvelopeSchema, bytes);
        // Track the high-water-mark seq so reconnect can resume from
        // the right point. Snapshots also carry the daemon-assigned
        // session_id; latch it so subsequent Subscribes echo it back.
        if (env.seq > this.lastSeq) this.lastSeq = env.seq;
        if (env.payload.case === 'snapshot' && env.payload.value.sessionId) {
          this.sessionId = env.payload.value.sessionId;
        }
        for (const l of this.listeners) l(env);
      } catch (err) {
        console.warn('failed to decode Envelope', err);
      }
    };

    ws.onclose = () => this.scheduleReconnect();
    ws.onerror = () => ws.close();
  }

  close(): void {
    this.closed = true;
    if (this.retry !== undefined) { clearTimeout(this.retry); this.retry = undefined; }
    this.ws?.close();
  }

  // Coarse view of the underlying socket for UI status display.
  // 'closed' covers both the no-socket-yet and gave-up cases; the
  // reconnect loop blurs them on its own.
  state(): 'open' | 'connecting' | 'closed' {
    if (!this.ws) return 'closed';
    switch (this.ws.readyState) {
      case WebSocket.OPEN: return 'open';
      case WebSocket.CONNECTING: return 'connecting';
      default: return 'closed';
    }
  }

  onEnvelope(fn: EnvelopeListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // Filter rule mutation: daemon applies via FilterMgr and broadcasts a
  // refreshed FilterRulesUpdate to all connected clients on success.
  // Silently no-ops if the socket isn't open — caller can react to the
  // resulting (or missing) FilterRulesUpdate to confirm.
  addFilterRule(filterType: number, pattern: string, perZone: boolean): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'addFilterRule',
        value: create(AddFilterRuleSchema, { filterType, pattern, perZone }),
      },
    });
    this.send(env);
  }

  removeFilterRule(filterType: number, pattern: string, perZone: boolean): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'removeFilterRule',
        value: create(RemoveFilterRuleSchema, { filterType, pattern, perZone }),
      },
    });
    this.send(env);
  }

  // Atomic filter-rule edit (replace pattern, keep type + scope). The
  // daemon does remove(old) + add(new) under one filtersChanged emit, so
  // other tabs see a single FilterRulesUpdate instead of a transient
  // empty state. To change type or scope, use removeFilterRule + addFilterRule.
  editFilterRule(
    filterType: number,
    oldPattern: string,
    newPattern: string,
    perZone: boolean,
  ): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'editFilterRule',
        value: create(EditFilterRuleSchema, {
          filterType,
          oldPattern,
          newPattern,
          perZone,
        }),
      },
    });
    this.send(env);
  }

  // Persist the daemon's in-memory filter rules to disk. Mirrors
  // showeq-c's "Save Filters" / "Save Zone Filters" menu items —
  // mutations are in-memory only until this is called, on purpose.
  // perZone=false writes the global filters file; true writes the
  // current zone's overlay file.
  saveFilters(perZone: boolean): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'saveFilters',
        value: create(SaveFiltersSchema, { perZone }),
      },
    });
    this.send(env);
  }

  // Trigger a daemon-side re-read of filter XML files from disk. Used when
  // an operator has edited the files outside the daemon. The daemon emits
  // a fresh FilterRulesUpdate to every connected client on success.
  reloadFilters(): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'reloadFilters',
        value: create(ReloadFiltersSchema, {}),
      },
    });
    this.send(env);
  }

  // Preference mutation. The daemon validates against its allowlist, persists
  // via XMLPreferences, and broadcasts a PrefChanged envelope to every
  // connected client (including this one). Caller picks the value variant by
  // passing exactly one of the four shapes.
  setPref(
    section: string,
    key: string,
    value:
      | { stringValue: string }
      | { intValue: bigint }
      | { doubleValue: number }
      | { boolValue: boolean },
  ): void {
    let pref;
    if ('stringValue' in value) {
      pref = create(PrefSchema, { section, key, value: { case: 'stringValue', value: value.stringValue } });
    } else if ('intValue' in value) {
      pref = create(PrefSchema, { section, key, value: { case: 'intValue', value: value.intValue } });
    } else if ('doubleValue' in value) {
      pref = create(PrefSchema, { section, key, value: { case: 'doubleValue', value: value.doubleValue } });
    } else {
      pref = create(PrefSchema, { section, key, value: { case: 'boolValue', value: value.boolValue } });
    }
    const env = create(ClientEnvelopeSchema, {
      payload: { case: 'setPref', value: create(SetPrefSchema, { pref }) },
    });
    this.send(env);
  }

  // Assign a user-curated label to a spawn point. `key` is the
  // SpawnPoint.key the daemon ships in its envelopes (decimal x|y|z).
  // The daemon writes through to the zone's <zone>.sp file and
  // broadcasts a SpawnPointUpdated to every connected client — no
  // local optimistic update needed; the UI re-renders when the echo
  // arrives. Empty `name` clears the label.
  renameSpawnPoint(key: string, name: string): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'renameSpawnPoint',
        value: create(RenameSpawnPointSchema, { key, name }),
      },
    });
    this.send(env);
  }

  // Ask the daemon for the current pcap_findalldevs() interface list.
  // The daemon replies on this connection only (not broadcast) with a
  // DevicesList envelope. Callers wire onEnvelope to pick that up —
  // there's no Promise wrapper because the answer also has to thread
  // through reconnect/replay handling.
  listDevices(): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'listDevices',
        value: create(ListDevicesSchema, {}),
      },
    });
    this.send(env);
  }

  // Ask the daemon for the available map provider packages (the
  // subdirectories under its maps root plus the synthetic "default" =
  // flat root). The daemon replies on this connection only with a
  // MapPackagesUpdate envelope. The daemon also sends one unprompted on
  // subscribe; this mirrors listDevices for parity so the picker
  // populates promptly. Callers wire onEnvelope to pick the reply up.
  listMapPackages(): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'listMapPackages',
        value: create(ListMapPackagesSchema, {}),
      },
    });
    this.send(env);
  }

  // Switch the daemon's active map provider package to `id` (as seen in
  // MapPackagesUpdate.packages[].id; "default" = the flat maps root).
  // The daemon persists the choice, re-resolves the current zone's map,
  // broadcasts a MapPackagesUpdate, and emits a fresh ZoneChanged with
  // the new geometry — so the map re-renders with no extra client work.
  // Unknown ids fall back to "default". Fire and forget; the UI reacts
  // to the resulting MapPackagesUpdate / ZoneChanged echoes.
  setMapPackage(id: string): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'setMapPackage',
        value: create(SetMapPackageSchema, { id }),
      },
    });
    this.send(env);
  }

  // Multibox: ask the daemon to switch its active decode target to
  // `boxId`. The daemon rebinds its SessionAdapter to that box's per-box
  // managers (non-destructive) and broadcasts a BoxListUpdated with the
  // new active_box_id; the UI reacts to that echo.
  setActiveBox(boxId: string): void {
    const env = create(ClientEnvelopeSchema, {
      payload: {
        case: 'setActiveBox',
        value: create(SetActiveBoxSchema, { boxId }),
      },
    });
    this.send(env);
  }

  private send(env: ReturnType<typeof create<typeof ClientEnvelopeSchema>>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(toBinary(ClientEnvelopeSchema, env));
  }

  // ONE pending retry, ever. A failing connection can deliver both `error` and `close`,
  // and the `error` handler closes the socket itself — so without this guard a single
  // failed attempt could arm two timers, and two become four. The browser decides how many
  // of those events it sends and in what order, which is why this must not depend on it.
  //
  // The cap is high and jittered on purpose: a URL that can NEVER work (daemon on another
  // machine, wrong port) must degrade to an occasional retry, not a permanent
  // connect/disconnect cycle that makes the app unusable while the user tries to correct
  // the address.
  private scheduleReconnect(): void {
    if (this.closed || this.retry !== undefined) return;
    const delay = this.backoffMs + Math.random() * 250;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect();
    }, delay);
  }
}
