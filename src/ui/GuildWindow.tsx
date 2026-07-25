import { FloatingWindow } from './FloatingWindow';
import { classDisplay } from './classes';
import type { SpawnStore } from '../state/store';

// Guild rank ids from the wire: 0 member, 1 officer, 2 leader.
const RANK_LABEL = ['Member', 'Officer', 'Leader'] as const;
function rankLabel(rank: number): string {
  return RANK_LABEL[rank] ?? `Rank ${rank}`;
}

// last_on is unix seconds (0 = never). A member in a zone (zone_id != 0) is
// online; otherwise show when they were last seen. The roster is the only
// trustworthy source for both (the member-update opcode's tail is garbage, so
// the daemon doesn't decode it).
function lastSeen(lastOn: number): string {
  if (!lastOn) return '—';
  const d = new Date(lastOn * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

// The guild popout: MOTD banner + the member roster. Popout-only (a
// FloatingWindow), never docked — a roster is reference data, not a main frame.
export function GuildWindow({
  store,
  tick,
  onClose,
}: {
  store: SpawnStore;
  tick: number;
  onClose: () => void;
}) {
  void tick;
  const roster = store.guildRosterState();
  const motd = store.guildMotdState();
  // Daemon sends members name-sorted; keep that order.
  const members = roster?.members ?? [];
  const online = members.filter((m) => m.zoneId !== 0).length;

  return (
    <FloatingWindow
      id="guild"
      title={`Guild${members.length ? ` (${online}/${members.length} online)` : ''}`}
      defaultSize={{ w: 460, h: 380 }}
      minSize={{ w: 300, h: 200 }}
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        {/* MOTD banner — an empty MOTD is real state (guild has none set), so
            distinguish it from "no MOTD packet yet" (motd undefined). */}
        {motd && (
          <div className="border-b border-border bg-bg-panel/60 px-2 py-1 text-xs">
            <span className="text-muted-foreground">MOTD: </span>
            {motd.message ? (
              <span className="text-foreground">{motd.message}</span>
            ) : (
              <span className="italic text-muted-foreground/60">none set</span>
            )}
            {motd.sender && (
              <span className="ml-1 text-muted-foreground/60">— {motd.sender}</span>
            )}
          </div>
        )}

        {members.length === 0 ? (
          <div className="flex-1 px-2 py-3 text-center text-xs text-muted-foreground">
            No guild roster yet — open your guild window in-game to request it.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-panel text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-1 text-left font-medium">Name</th>
                  <th className="px-1 py-1 text-right font-medium">Lvl</th>
                  <th className="px-1 py-1 text-left font-medium">Class</th>
                  <th className="px-2 py-1 text-left font-medium">Rank</th>
                  <th className="px-2 py-1 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.name} className="border-b border-border/40 last:border-0">
                    <td className="px-2 py-0.5 text-foreground">
                      {m.name}
                      {m.banker && <span className="ml-1 text-amber-500" title="Banker">$</span>}
                      {m.alt && <span className="ml-1 text-muted-foreground/60" title="Alt">A</span>}
                      {m.publicNote && (
                        <span className="ml-1 truncate text-muted-foreground/50" title={m.publicNote}>
                          — {m.publicNote}
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-0.5 text-right font-mono">{m.level || '—'}</td>
                    <td className="px-1 py-0.5" title={classDisplay(m.classMask, m.class)}>
                      {classDisplay(m.classMask, m.class, { short: true })}
                    </td>
                    <td className="px-2 py-0.5">{rankLabel(m.rank)}</td>
                    <td className="px-2 py-0.5">
                      {m.zoneId !== 0 ? (
                        <span className="text-green-500">Online</span>
                      ) : (
                        <span className="text-muted-foreground/60">{lastSeen(m.lastOn)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FloatingWindow>
  );
}
