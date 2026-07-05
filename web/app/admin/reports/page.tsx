import { notFound } from "next/navigation";
import Link from "next/link";
import type { components } from "@fountainrank/api-client";
import { SiteHeader } from "../../../components/SiteHeader";
import { ReportedPhotoActions } from "../../../components/admin/ReportedPhotoActions";
import { getViewer } from "../../../lib/server/viewer";
import { getPhotoReportsServer } from "../../../lib/server/photo-reports";
import { resolveApiBaseUrl } from "../../../lib/api";
import { signInWithReturn } from "../../actions/auth";

export const dynamic = "force-dynamic";

type ReportedPhotoOut = components["schemas"]["ReportedPhotoOut"];

// `thumbnail_url` is an API-relative gated read path (`/api/v1/photos/{id}/thumb`), never a
// durable object URL (docs/style-guide.md "Fountain photos (PR 2)") — the web app and API are
// served from different origins, so the API base has to be prefixed to resolve in the browser.
function resolvePhotoUrl(path: string): string {
  return `${resolveApiBaseUrl()}${path}`;
}

function ReportedPhotoRow({ photo }: { photo: ReportedPhotoOut }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-start">
      {/* eslint-disable-next-line @next/next/no-img-element -- gated API-relative photo path */}
      <img
        src={resolvePhotoUrl(photo.thumbnail_url)}
        alt=""
        loading="lazy"
        className="h-16 w-16 shrink-0 rounded-md object-cover"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`/fountains/${photo.fountain_id}`}
          className="text-sm font-semibold text-[#0A357E] hover:underline"
        >
          View fountain
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
            {photo.report_count} report{photo.report_count > 1 ? "s" : ""}
          </span>
          {photo.is_hidden && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
              Hidden
            </span>
          )}
          {photo.categories.map((c) => (
            <span
              key={c}
              className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600"
            >
              {c}
            </span>
          ))}
        </div>
        {photo.notes.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {photo.notes.map((n, i) => (
              <li key={i} className="truncate break-words">
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ReportedPhotoActions photoId={photo.photo_id} isHidden={photo.is_hidden} />
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
          <h1 className="text-lg font-bold text-[#0A357E]">Admin</h1>
          <p className="mt-2 text-slate-600">Sign in to access the admin tools.</p>
          <form action={signInWithReturn.bind(null, "/admin/reports")} className="mt-3">
            <button
              type="submit"
              className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
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
          <h1 className="text-lg font-bold text-[#0A357E]">Couldn&rsquo;t verify admin access</h1>
          <p className="mt-2 text-slate-600">Please try again in a moment.</p>
        </main>
      </>
    );
  }
  if (!viewer.isAdmin) notFound();

  const { data: photos } = await getPhotoReportsServer(crypto.randomUUID());

  return (
    <>
      <SiteHeader variant="bar" />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-lg font-bold text-[#0A357E]">Photo reports</h1>
        <p className="mt-2 text-slate-600">
          Review photos flagged by the community and hide, dismiss, or delete them.
        </p>
        {photos && photos.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {photos.map((photo) => (
              <ReportedPhotoRow key={photo.photo_id} photo={photo} />
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-slate-500">No pending reports.</p>
        )}
      </main>
    </>
  );
}
