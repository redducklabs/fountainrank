import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "../../../../components/SiteHeader";
import {
  contributionEventLabel,
  signedContributionPoints,
} from "../../../../lib/admin/contributions";
import { getAuthedApiClient } from "../../../../lib/server/api";
import { log } from "../../../../lib/server/log";
import { getViewer } from "../../../../lib/server/viewer";

export const dynamic = "force-dynamic";

export default async function ContributorHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const requestId = crypto.randomUUID();
  const viewer = await getViewer(requestId);
  if (viewer.state !== "authed" || !viewer.isAdmin) notFound();
  const [{ userId }, query] = await Promise.all([params, searchParams]);
  const client = await getAuthedApiClient(requestId);
  const result = await client
    .GET("/api/v1/admin/contributors/{user_id}/contributions", {
      params: { path: { user_id: userId }, query: { cursor: query.cursor, limit: 50 } },
    })
    .catch(() => null);
  if (result?.response.status === 404) notFound();
  const data = result?.data;
  if (!data) {
    log("warn", "failed to load contributor history", {
      requestId,
      status: result?.response.status ?? "transport-error",
    });
  }

  return (
    <>
      <SiteHeader variant="bar" />
      <main className="mx-auto min-h-dvh max-w-2xl bg-surface-raised px-6 py-10">
        <Link href="/leaderboard" className="text-sm text-brand-ink underline">
          ← Back to leaderboard
        </Link>
        {!data ? (
          <p className="mt-8 text-danger">Couldn&rsquo;t load this contribution history.</p>
        ) : (
          <>
            <h1 className="mt-6 text-2xl font-black text-brand-ink">{data.display_name}</h1>
            <p className="mt-1 text-sm text-muted">
              {data.stats.total_points.toLocaleString()} points · {data.events.length} events on
              this page
            </p>
            {data.events.length === 0 ? (
              <p className="mt-8 text-muted">No contribution events recorded.</p>
            ) : (
              <ol className="mt-6 divide-y divide-border" aria-label="Contribution event history">
                {data.events.map((event) => (
                  <li key={event.id} className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-foreground">
                          {contributionEventLabel(event.event_type)}
                        </p>
                        <p className="text-xs text-muted">
                          {new Date(event.created_at).toLocaleString()} · {event.status}
                        </p>
                        {event.fountain_id ? (
                          <Link
                            href={`/fountains/${event.fountain_id}`}
                            className="text-xs text-brand-ink underline"
                          >
                            View fountain
                          </Link>
                        ) : event.target_type ? (
                          <p className="text-xs text-muted">Target: {event.target_type}</p>
                        ) : null}
                      </div>
                      <span
                        className={
                          "font-black tabular-nums " +
                          (event.status === "reversed" ? "text-danger" : "text-brand-ink")
                        }
                      >
                        {signedContributionPoints(event.points, event.status)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {data.next_cursor ? (
              <Link
                href={`/admin/contributors/${userId}?cursor=${encodeURIComponent(data.next_cursor)}`}
                className="mt-6 inline-flex rounded-full bg-brand px-4 py-2 text-sm font-bold text-on-brand"
              >
                Next page
              </Link>
            ) : (
              <p className="mt-6 text-sm text-muted">End of history.</p>
            )}
          </>
        )}
      </main>
    </>
  );
}
