import { notFound } from "next/navigation";
import Link from "next/link";
import type { components } from "@fountainrank/api-client";
import { SiteHeader } from "../../../components/SiteHeader";
import { LoadableImage } from "../../../components/ui/LoadableImage";
import { ReportedContentActions } from "../../../components/admin/ReportedContentActions";
import { getViewer } from "../../../lib/server/viewer";
import { getContentReportsServer } from "../../../lib/server/content-reports";
import { log } from "../../../lib/server/log";
import { resolveApiBaseUrl } from "../../../lib/api";
import { signInWithReturn } from "../../actions/auth";

export const dynamic = "force-dynamic";

type ReportedContentOut = components["schemas"]["ReportedContentOut"];

// `thumbnail_url` is an API-relative gated read path (`/api/v1/photos/{id}/thumb`), never a
// durable object URL (docs/style-guide.md "Fountain photos (PR 2)") — the web app and API are
// served from different origins, so the API base has to be prefixed to resolve in the browser.
function resolvePhotoUrl(path: string): string {
  return `${resolveApiBaseUrl()}${path}`;
}

function ReportChips({ item }: { item: ReportedContentOut }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800 dark:bg-red-500/15 dark:text-red-300">
        {item.report_count} report{item.report_count > 1 ? "s" : ""}
      </span>
      {item.is_hidden && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          Hidden
        </span>
      )}
      {item.categories.map((c) => (
        <span key={c} className="rounded-full bg-border px-2 py-0.5 text-xs font-medium text-muted">
          {c}
        </span>
      ))}
    </div>
  );
}

function ReportNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-muted">
      {notes.map((n, i) => (
        <li key={i} className="truncate break-words">
          {n}
        </li>
      ))}
    </ul>
  );
}

function FountainLink({ fountainId, label }: { fountainId: string; label: string }) {
  return (
    <Link
      href={`/fountains/${fountainId}`}
      className="text-sm font-semibold text-brand-ink hover:underline"
    >
      {label}
    </Link>
  );
}

function ReportedContentRow({ item }: { item: ReportedContentOut }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-start">
      {item.content_type === "photo" && item.thumbnail_url && (
        <LoadableImage
          src={resolvePhotoUrl(item.thumbnail_url)}
          alt=""
          loading="lazy"
          wrapperClassName="h-16 w-16 shrink-0 rounded-md"
          className="h-16 w-16 object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        {item.content_type === "photo" && (
          <FountainLink fountainId={item.fountain_id} label="View fountain" />
        )}
        {item.content_type === "note" && (
          <div>
            <p className="text-sm text-brand-ink">{item.excerpt}</p>
            <p className="mt-0.5 text-xs text-muted">
              {item.contributor ? `by ${item.contributor} · ` : ""}
              <FountainLink fountainId={item.fountain_id} label="View fountain" />
            </p>
          </div>
        )}
        {item.content_type === "fountain" && (
          <div>
            <p className="text-sm font-semibold text-brand-ink">
              {item.fountain_label ?? "Fountain"}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              <FountainLink fountainId={item.fountain_id} label="View fountain" />
            </p>
          </div>
        )}
        <ReportChips item={item} />
        <ReportNotes notes={item.notes} />
      </div>
      <ReportedContentActions
        contentType={item.content_type as "photo" | "note" | "fountain"}
        contentId={item.content_id}
        fountainId={item.fountain_id}
        isHidden={item.is_hidden}
        contributorUserId={item.contributor_user_id}
        contributorAccountStatus={item.contributor_account_status}
      />
    </li>
  );
}

export default async function AdminReportsPage() {
  const viewer = await getViewer(crypto.randomUUID());
  if (viewer.state === "anonymous") {
    // IMPORTANT: do NOT call signInWithReturn() directly here — it mutates cookies, which is
    // only allowed in a Server Action / Route Handler, never during an RSC render. Render a
    // sign-in FORM instead; submitting it runs the action in a valid (cookie-writable) context.
    return (
      <>
        <SiteHeader variant="bar" />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-lg font-bold text-brand-ink">Admin</h1>
          <p className="mt-2 text-muted">Sign in to access the admin tools.</p>
          <form action={signInWithReturn.bind(null, "/admin/reports")} className="mt-3">
            <button
              type="submit"
              className="rounded-full bg-accent-gold px-4 py-2 text-sm font-bold text-brand"
            >
              Sign in
            </button>
          </form>
        </main>
      </>
    );
  }
  if (viewer.state === "error") {
    return (
      <>
        <SiteHeader variant="bar" />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-lg font-bold text-brand-ink">Couldn&rsquo;t verify admin access</h1>
          <p className="mt-2 text-muted">Please try again in a moment.</p>
        </main>
      </>
    );
  }
  if (!viewer.isAdmin) notFound();

  const requestId = crypto.randomUUID();
  const { data: reports, status } = await getContentReportsServer(requestId);
  const reportsOk = status >= 200 && status < 300;
  if (!reportsOk) {
    log("warn", "failed to load content reports", { requestId, status });
  }

  return (
    <>
      <SiteHeader variant="bar" />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-lg font-bold text-brand-ink">Moderation queue</h1>
        <p className="mt-2 text-muted">
          Review photos, notes, and fountains flagged by the community and hide, reject, or remove
          them.
        </p>
        {!reportsOk ? (
          <p className="mt-6 text-sm text-danger">
            Couldn&rsquo;t load reports right now — please retry.
          </p>
        ) : reports && reports.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {reports.map((item) => (
              <ReportedContentRow key={`${item.content_type}:${item.content_id}`} item={item} />
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-muted">No pending reports.</p>
        )}
      </main>
    </>
  );
}
