import {
  getFountainDetailServer,
  getFountainNotesServer,
  getFountainPhotosServer,
} from "../../../../lib/fountains";
import { getAdminFountainDetailServer } from "../../../../lib/server/admin";
import { getViewerAccessToken } from "../../../../lib/server/api";
import { log } from "../../../../lib/server/log";
import { getViewer } from "../../../../lib/server/viewer";
import { FountainAdminControls } from "../../../../components/admin/FountainAdminControls";
import { FountainDetail } from "../../../../components/fountain/FountainDetail";
import { DetailOverlay } from "../../../../components/fountain/DetailOverlay";

export const dynamic = "force-dynamic";

export default async function FountainModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const viewer = await getViewer(requestId);
  const isAuthenticated = viewer.state === "authed";
  const isAdmin = viewer.state === "authed" && viewer.isAdmin;
  const adminRes = isAdmin ? await getAdminFountainDetailServer(id, requestId) : null;
  // Authenticate the public detail + photos fetches when signed in so `your_rating` comes back
  // (#65 web parity, #114) and owner photo controls are available.
  const [{ data, status }, notesRes, photosRes] = adminRes
    ? [
        { data: adminRes.data, status: adminRes.status },
        { data: adminRes.data?.notes, status: adminRes.status },
        await getViewerAccessToken().then((token) => getFountainPhotosServer(id, requestId, token)),
      ]
    : await Promise.all([
        getViewerAccessToken().then((token) => getFountainDetailServer(id, requestId, token)),
        getFountainNotesServer(id, requestId),
        getViewerAccessToken().then((token) => getFountainPhotosServer(id, requestId, token)),
      ]);

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
  const photosOk = photosRes.status >= 200 && photosRes.status < 300;
  if (!photosOk) {
    log("warn", "failed to load fountain photos (overlay)", {
      requestId,
      id,
      status: photosRes.status,
    });
  }
  const photos = photosOk && photosRes.data ? photosRes.data : [];
  return (
    <DetailOverlay>
      <FountainDetail
        detail={data}
        notes={notes}
        photos={photos}
        isAuthenticated={isAuthenticated}
        adminControls={adminRes?.data ? <FountainAdminControls detail={adminRes.data} /> : null}
      />
    </DetailOverlay>
  );
}
