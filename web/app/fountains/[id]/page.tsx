import Link from "next/link";
import { notFound } from "next/navigation";
import { getFountainDetailServer, getFountainNotesServer } from "../../../lib/fountains";
import { getViewerAccessToken } from "../../../lib/server/api";
import { log } from "../../../lib/server/log";
import { getViewer, getViewerTotalPoints } from "../../../lib/server/viewer";
import { ContributionStatusOverlay } from "../../../components/contributions/ContributionStatusOverlay";
import { FountainDetail } from "../../../components/fountain/FountainDetail";
import { SiteHeader } from "../../../components/SiteHeader";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10";

export default async function FountainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  // Authenticate the detail fetch when signed in so `your_rating` comes back (#65 web
  // parity, #114). The token fetch is chained into the detail call so notes + viewer
  // still run in parallel; anonymous → null token → unchanged anonymous response.
  const [{ data, status }, notesRes, viewer] = await Promise.all([
    getViewerAccessToken().then((token) => getFountainDetailServer(id, requestId, token)),
    getFountainNotesServer(id, requestId),
    getViewer(requestId),
  ]);
  const isAuthenticated = viewer.state === "authed";

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
  const initialTotalPoints = isAuthenticated ? await getViewerTotalPoints(requestId) : 0;
  return (
    <>
      <SiteHeader variant="bar" />
      {isAuthenticated ? (
        <ContributionStatusOverlay initialTotalPoints={initialTotalPoints} />
      ) : null}
      <main className={shell}>
        <Link href="/" className="text-sm text-[#0C44A0] underline">
          ← Back to the map
        </Link>
        <div className="mt-6">
          <FountainDetail detail={data} notes={notes} isAuthenticated={isAuthenticated} />
        </div>
      </main>
    </>
  );
}
