import Link from "next/link";
import {
  LEADERBOARD_SORTS,
  SORT_LABELS,
  leaderboardControlHref,
  type LeaderboardScope,
  type ParsedLeaderboard,
} from "../../lib/leaderboard";

// Scope toggle (Global / Near here) + category chips. Every control is a plain <Link> that flips a
// query param and lets the server re-render — no client state. "Near here" only appears when a map
// center is present in the URL.
export function LeaderboardControls({ state }: { state: ParsedLeaderboard }) {
  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Leaderboard scope"
        className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1"
      >
        <ScopeLink state={state} scope="global" label="Global" />
        {state.center ? <ScopeLink state={state} scope="near" label="Near here" /> : null}
      </div>
      <div role="group" aria-label="Sort by category" className="flex flex-wrap gap-2">
        {LEADERBOARD_SORTS.map((sort) => {
          const active = state.sort === sort;
          return (
            <Link
              key={sort}
              href={leaderboardControlHref(state, { sort })}
              aria-current={active ? "true" : undefined}
              className={
                "rounded-full border px-3 py-1.5 text-sm font-semibold transition " +
                (active
                  ? "border-[#0A357E] bg-[#0A357E] text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-[#0C44A0] hover:text-[#0C44A0]")
              }
            >
              {SORT_LABELS[sort]}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ScopeLink({
  state,
  scope,
  label,
}: {
  state: ParsedLeaderboard;
  scope: LeaderboardScope;
  label: string;
}) {
  const active = state.scope === scope;
  return (
    <Link
      href={leaderboardControlHref(state, { scope })}
      aria-current={active ? "true" : undefined}
      className={
        "rounded-full px-4 py-1.5 text-sm font-semibold transition " +
        (active ? "bg-[#0A357E] text-white" : "text-slate-600 hover:text-[#0A357E]")
      }
    >
      {label}
    </Link>
  );
}
