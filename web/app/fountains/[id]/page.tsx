import Link from "next/link";
import { notFound } from "next/navigation";
import { getFountainDetailServer } from "../../../lib/fountains";
import { log } from "../../../lib/server/log";
import { FountainDetail } from "../../../components/fountain/FountainDetail";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10";

export default async function FountainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const { data, status } = await getFountainDetailServer(id, requestId);

  if (status === 404) {
    log("info", "fountain not found", { requestId, id, status });
    notFound(); // renders not-found UI AND returns HTTP 404 (SEO/crawlers)
  }
  if (!data) {
    log("error", "failed to load fountain", { requestId, id, status });
    return (
      <main className={shell}>
        <Link href="/" className="text-sm text-[#0C44A0] underline">
          ← Back to the map
        </Link>
        <h1 className="mt-6 text-lg font-bold text-[#0A357E]">Couldn&rsquo;t load this fountain</h1>
        <p className="mt-2 text-slate-600">Please try again.</p>
      </main>
    );
  }
  return (
    <main className={shell}>
      <Link href="/" className="text-sm text-[#0C44A0] underline">
        ← Back to the map
      </Link>
      <div className="mt-6">
        <FountainDetail detail={data} />
      </div>
    </main>
  );
}
