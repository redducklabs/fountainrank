import Image from "next/image";
import Link from "next/link";
import { AuthControl } from "./AuthControl";
import { HeaderPoints } from "./HeaderPoints";
import { HeaderSearch } from "./HeaderSearch";
import { getViewer, getViewerTotalPoints } from "../lib/server/viewer";
import { getPendingReportCountServer } from "../lib/server/photo-reports";

export async function SiteHeader({ variant }: { variant: "hero" | "bar" }) {
  const requestId = crypto.randomUUID();
  const viewer = await getViewer(requestId);
  const totalPoints = viewer.state === "authed" ? await getViewerTotalPoints(requestId) : null;
  // Only admins ever see the badge (style guide §"Pending-report badge"); skip the read
  // entirely for everyone else so a non-admin page render never issues the extra call.
  const pendingReportCount =
    viewer.state === "authed" && viewer.isAdmin
      ? await getPendingReportCountServer(requestId)
      : null;
  return (
    <header className="relative z-50 bg-gradient-to-b from-[#0A357E] to-[#0E4DA4] px-6 py-3 text-white">
      {/* Ever-present header search (design doc §4.1): a single flex row that reads
          logo - search - points/auth inline on md+ screens (search is `flex-1 max-w-md`
          between the two fixed-width clusters), and wraps the search onto its own full-width
          row below logo/points on narrower screens (`order-3 w-full` by default, reset to the
          natural in-DOM order at `md:`) so it never squeezes out the points/auth cluster or
          the hero subtitle below. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <Link href="/" aria-label="FountainRank home" className="shrink-0">
          <Image
            src="/fountainrank-logo.png"
            alt="FountainRank"
            width={480}
            height={205}
            priority
            className="h-9 w-auto"
          />
        </Link>
        <div className="order-3 w-full md:order-none md:w-auto md:max-w-md md:flex-1">
          <HeaderSearch />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {totalPoints != null && <HeaderPoints initialTotalPoints={totalPoints} />}
          <AuthControl viewer={viewer} initialPendingReportCount={pendingReportCount} />
        </div>
      </div>
      {variant === "hero" && (
        <p className="mt-2 text-sm font-semibold sm:text-base">
          Find a drinking fountain near you.
        </p>
      )}
    </header>
  );
}
