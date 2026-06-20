import { getFountainDetailServer } from "../../../../lib/fountains";
import { log } from "../../../../lib/server/log";
import { FountainDetail } from "../../../../components/fountain/FountainDetail";
import { DetailOverlay } from "../../../../components/fountain/DetailOverlay";

export const dynamic = "force-dynamic";

export default async function FountainModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const { data, status } = await getFountainDetailServer(id, requestId);

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
  return (
    <DetailOverlay>
      <FountainDetail detail={data} />
    </DetailOverlay>
  );
}
