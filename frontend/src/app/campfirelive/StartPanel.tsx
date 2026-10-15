"use client";

// "Start something" — the dashboard's action panel. Pick WHAT first (by kind of
// activity), then which group (or a new one). Right-hand column on wide screens,
// under "Your turn" on phones.

// The "Start something" panel: pick WHAT first (by kind of activity), then which group.
export type StartAction = {
  key: string;
  emoji: string;
  title: string;
  sub: string;
  start: string; // ?start= key: a template id, or "type:<engagement type>"
  path: string; // the new-activity query for an existing group
  hot?: boolean;
  androidHidden?: boolean; // money features stay off the Android app
};
export const START_ACTIONS: StartAction[] = [
  { key: "card", emoji: "💌", title: "Send a group card", sub: "Birthday, thanks, get-well…", start: "type:birthday", path: "?type=birthday" },
  { key: "contest", emoji: "🏆", title: "Start a photo contest", sub: "Everyone enters, the group votes", start: "photo-contest", path: "?template=photo-contest" },
  { key: "poll", emoji: "📊", title: "Ask a quick poll", sub: "Answers open together", start: "type:poll", path: "?type=poll" },
  { key: "awards", emoji: "🏅", title: "Hand out awards", sub: "Funniest, best cook, MVP…", start: "hall-of-fame", path: "?template=hall-of-fame" },
  { key: "game", emoji: "🎲", title: "Play a game", sub: "Two truths & a lie", start: "two-truths", path: "?template=two-truths" },
  { key: "signup", emoji: "📝", title: "Make a sign-up list", sub: "Potluck — who brings what", start: "party-potluck", path: "?template=party-potluck" },
  { key: "care", emoji: "🤝", title: "Check in on everyone", sub: "How's everyone doing?", start: "care-checkin", path: "?template=care-checkin" },
  { key: "raffle", emoji: "🎟️", title: "Run a raffle", sub: "Chip in, draw a winner", start: "raffle-draw", path: "?template=raffle-draw", androidHidden: true },
];


type PanelGroup = { id: string; name: string; avatar_emoji: string; creator_id: string };

export default function StartPanel({
  groups,
  userId,
  pickAction,
  setPickAction,
  seasonAction,
  trendingLabel,
  onNewGroup,
  onGroup,
  onJoin,
}: {
  groups: PanelGroup[];
  userId?: string;
  pickAction: StartAction | null;
  setPickAction: (a: StartAction | null) => void;
  seasonAction: StartAction | null;
  trendingLabel: string | null;
  onNewGroup: (a: StartAction) => void;
  onGroup: (a: StartAction, groupId: string) => void;
  onJoin: () => void;
}) {
  const sortedGroups = [...groups].sort(
    (a, b) => Number(b.creator_id === userId) - Number(a.creator_id === userId)
  );
  const pick = (a: StartAction) => (groups.length === 0 ? onNewGroup(a) : setPickAction(a));
  return (
      <div className="rounded-3xl border-2 border-orange-200 bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 shadow-sm">
        {pickAction ? (
          <>
            <button
              type="button"
              onClick={() => setPickAction(null)}
              className="mb-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              ← Back
            </button>
            <div className="flex items-center gap-2">
              <span className="text-3xl">{pickAction.emoji}</span>
              <div className="min-w-0">
                <div className="font-extrabold text-slate-900">{pickAction.title}</div>
                <div className="text-xs text-slate-600">For which group?</div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {sortedGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onGroup(pickAction, g.id)}
                  className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-semibold text-slate-800 shadow-sm hover:border-orange-300"
                >
                  <span className="text-lg">{g.avatar_emoji}</span>
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  <span className="text-orange-500">→</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => onNewGroup(pickAction)}
                className="flex w-full items-center gap-2 rounded-xl border-2 border-dashed border-orange-200 px-3 py-2.5 text-left text-sm font-semibold text-orange-700 hover:border-orange-300 hover:bg-orange-50"
              >
                <span className="text-lg">➕</span> A new group
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-lg font-extrabold text-slate-900">✨ Start something</div>
            <div className="mb-3 text-xs text-slate-600">Pick what — then which group.</div>
            {seasonAction && (
              <button
                type="button"
                onClick={() => pick(seasonAction)}
                className="mb-2 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:opacity-95"
              >
                <span className="text-3xl">{seasonAction.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold leading-snug">{seasonAction.title}</span>
                  <span className="block text-xs text-white/90">{seasonAction.sub}</span>
                </span>
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {START_ACTIONS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  {...(a.androidHidden ? { "data-hide-on-android": true } : {})}
                  onClick={() => pick(a)}
                  className="flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300"
                >
                  <span className="text-2xl leading-none">{a.emoji}</span>
                  <span className="mt-1.5 text-[13px] font-bold leading-snug text-slate-900">{a.title}</span>
                  <span className="mt-0.5 text-[11px] leading-snug text-slate-500">{a.sub}</span>
                </button>
              ))}
            </div>
            {groups.length === 0 ? (
              <button
                type="button"
                onClick={onJoin}
                className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-orange-300"
              >
                🔑 I have an invite code
              </button>
            ) : (
              trendingLabel && (
                <p className="mt-3 text-center text-[11px] text-slate-500">
                  🔥 Trending on Campfire: {trendingLabel}
                </p>
              )
            )}
          </>
        )}
      </div>
  );
}
