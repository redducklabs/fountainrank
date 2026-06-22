import { getFountainDetailServer, getFountainNotesServer } from "../../../../lib/fountains";
import { log } from "../../../../lib/server/log";
import { getViewer } from "../../../../lib/server/viewer";
import { FountainDetail } from "../../../../components/fountain/FountainDetail";
import { DetailOverlay } from "../../../../components/fountain/DetailOverlay";

export const dynamic = "force-dynamic";

export default async function FountainModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const [{ data, status }, notesRes, viewer] = await Promise.all([
    getFountainDetailServer(id, requestId),
    getFountainNotesServer(id, requestId),
    getViewer(requestId),
  ]);
  const isAuthenticated = viewer.state === "authed";

  if (status === 404) {
    log("info", "fountain not found (overlay)", { requestId, id, status });
    return (
      <DetailOverlay>
        <p className="text-slate-600">Fountain not found.</p>
      </DetailOverlay>
    );
  }
  if (!data) {
    log("error", "failed to load fountain (overlay)", { requestId, id, status });
    return (
      <DetailOverlay>
        <p className="text-slate-600">Couldn&rsquo;t load this fountain.</p>
      </DetailOverlay>
    );
  }
  const notesOk = notesRes.status >= 200 && notesRes.status < 300;
  if (!notesOk) {
    log("warn", "failed to load fountain notes (overlay)", {
      requestId,
      id,
      status: notesRes.status,
    });
  }
  const notes = notesOk && notesRes.data ? notesRes.data : [];
  return (
    <DetailOverlay>
      <FountainDetail detail={data} notes={notes} isAuthenticated={isAuthenticated} />
    </DetailOverlay>
  );
}
