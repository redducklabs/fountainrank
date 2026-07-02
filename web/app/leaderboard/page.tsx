import type { Metadata } from "next";
import Link from "next/link";
import { LeaderboardControls } from "../../components/leaderboard/LeaderboardControls";
import { LeaderboardRows } from "../../components/leaderboard/LeaderboardRows";
import { SiteHeader } from "../../components/SiteHeader";
import { getLeaderboardServer, parseLeaderboardParams } from "../../lib/leaderboard";
import { getViewerAccessToken } from "../../lib/server/api";
import { log } from "../../lib/server/log";

export const dynamic = "force-dynamic";

// The rankings page is a public organic-search entry point; canonicalize it to
// the sort/scope-agnostic URL so query-string variants don't split signals (#126).
export const metadata: Metadata = {
  alternates: { canonical: "/leaderboard" },
};
const shell = "mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const state = parseLeaderboardParams(sp);
  const requestId = crypto.randomUUID();
  // Authenticate the public read when the viewer is signed in so `you` comes back (#117);
  // anonymous visitors get the global/near board without a personal standing.
  const token = await getViewerAccessToken();
  const { data, status } = await getLeaderboardServer(state.query, requestId, token);
  if (!data) {
    log("error", "failed to load leaderboard", { requestId, status });
  }

  return (
    <>
      <SiteHeader variant="bar" />
      <main className={shell}>
        <Link href="/" className="text-sm text-[#0C44A0] underline">
          ← Back to the map
        </Link>
        <h1 className="mt-6 text-2xl font-black text-[#0A357E]">Leaderboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          {state.scope === "near"
            ? "Top contributors near this part of the map."
            : "Top contributors everywhere."}
        </p>
        <div className="mt-5">
          <LeaderboardControls state={state} />
        </div>
        {data ? (
          <LeaderboardRows rows={data.rows} you={data.you ?? null} sort={state.sort} />
        ) : (
          <p className="mt-8 text-center text-slate-500">
            Couldn&rsquo;t load the leaderboard. Please try again.
          </p>
        )}
      </main>
    </>
  );
}
