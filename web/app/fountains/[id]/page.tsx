import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  getFountainDetailServer,
  getFountainNotesServer,
  getFountainPhotosServer,
} from "../../../lib/fountains";
import { fountainPath, getFountainPlaceServer } from "../../../lib/places";
import { getAdminFountainDetailServer } from "../../../lib/server/admin";
import { getViewerAccessToken } from "../../../lib/server/api";
import { log } from "../../../lib/server/log";
import { getViewer } from "../../../lib/server/viewer";
import { FountainAdminControls } from "../../../components/admin/FountainAdminControls";
import { ContributionStatusOverlay } from "../../../components/contributions/ContributionStatusOverlay";
import { FountainDetail } from "../../../components/fountain/FountainDetail";
import { SiteHeader } from "../../../components/SiteHeader";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10";

// cache() dedupes the PUBLIC place fetch between generateMetadata() and the page render within one
// request. It drives BOTH the indexing verdict (spec §7) and the city h1 label from public,
// non-hidden data only — never the viewer/admin detail path, so auth/admin state can't affect SEO.
const loadFountainPlace = cache((id: string) => getFountainPlaceServer(id, crypto.randomUUID()));

// The public city label for the h1, e.g. "Public drinking fountain in Manhattan". Undefined when no
// city resolves (or the backend is down), so the component falls back to the generic label.
function cityLabel(name: string | undefined): string | undefined {
  return name ? `Public drinking fountain in ${name}` : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { data } = await loadFountainPlace(id);
  // Hidden / unknown (404) or backend-down (status 0): keep out of the index. `follow: false`
  // mirrors the city page's missing-data behavior.
  if (!data) return { robots: { index: false, follow: false } };
  const cityName = data.city?.name;
  const title = cityName ? `Drinking fountain in ${cityName}` : "Public drinking fountain";
  const description = cityName
    ? `A public drinking fountain in ${cityName} — see its rating, working status, and get directions on FountainRank.`
    : "A public drinking fountain — see its rating, working status, and get directions on FountainRank.";
  const canonical = fountainPath(id);
  return {
    title,
    description,
    alternates: { canonical },
    // Below the §7 predicate (thin / broken-and-unrated / no city): render, but keep out of the
    // index — still followable so crawlers reach the linked map + place pages.
    robots: data.indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function FountainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const viewer = await getViewer(requestId);
  const isAuthenticated = viewer.state === "authed";
  const isAdmin = viewer.state === "authed" && viewer.isAdmin;
  const adminRes = isAdmin ? await getAdminFountainDetailServer(id, requestId) : null;
  // Authenticate the public detail fetch when signed in so `your_rating` comes back (#65
  // web parity, #114). Admins use the admin detail endpoint instead so hidden notes and
  // hidden fountains are reachable.
  const [{ data, status }, notesRes, photosRes] = adminRes
    ? [
        { data: adminRes.data, status: adminRes.status },
        { data: adminRes.data?.notes, status: adminRes.status },
        await getFountainPhotosServer(id, requestId),
      ]
    : await Promise.all([
        getViewerAccessToken().then((token) => getFountainDetailServer(id, requestId, token)),
        getFountainNotesServer(id, requestId),
        getFountainPhotosServer(id, requestId),
      ]);

  if (status === 404) {
    log("info", "fountain not found", { requestId, id, status });
    notFound();
  }
  if (!data) {
    log("error", "failed to load fountain", { requestId, id, status });
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          <Link href="/" className="text-sm text-[#0C44A0] underline">
            ← Back to the map
          </Link>
          <h1 className="mt-6 text-lg font-bold text-[#0A357E]">
            Couldn&rsquo;t load this fountain
          </h1>
          <p className="mt-2 text-slate-600">Please try again.</p>
        </main>
      </>
    );
  }
  const notesOk = notesRes.status >= 200 && notesRes.status < 300;
  if (!notesOk) {
    log("warn", "failed to load fountain notes", { requestId, id, status: notesRes.status });
  }
  const notes = notesOk && notesRes.data ? notesRes.data : [];
  const photosOk = photosRes.status >= 200 && photosRes.status < 300;
  if (!photosOk) {
    log("warn", "failed to load fountain photos", { requestId, id, status: photosRes.status });
  }
  const photos = photosOk && photosRes.data ? photosRes.data : [];
  // The PUBLIC city label for the h1 (spec §7): cached, so this reuses generateMetadata's fetch.
  const { data: placeData } = await loadFountainPlace(id);
  const locationLabel = cityLabel(placeData?.city?.name);
  return (
    <>
      <SiteHeader variant="bar" />
      {isAuthenticated ? <ContributionStatusOverlay /> : null}
      <main className={shell}>
        <Link href="/" className="text-sm text-[#0C44A0] underline">
          ← Back to the map
        </Link>
        <div className="mt-6">
          <FountainDetail
            detail={data}
            notes={notes}
            photos={photos}
            isAuthenticated={isAuthenticated}
            viewerDisplayName={viewer.state === "authed" ? viewer.displayName : undefined}
            adminControls={adminRes?.data ? <FountainAdminControls detail={adminRes.data} /> : null}
            locationLabel={locationLabel}
          />
        </div>
      </main>
    </>
  );
}
