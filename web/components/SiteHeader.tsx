import Image from "next/image";
import Link from "next/link";
import { AuthControl } from "./AuthControl";
import { HeaderPoints } from "./HeaderPoints";
import { getViewer, getViewerTotalPoints } from "../lib/server/viewer";

export async function SiteHeader({ variant }: { variant: "hero" | "bar" }) {
  const requestId = crypto.randomUUID();
  const viewer = await getViewer(requestId);
  const totalPoints = viewer.state === "authed" ? await getViewerTotalPoints(requestId) : null;
  return (
    <header className="relative z-50 bg-gradient-to-b from-[#0A357E] to-[#0E4DA4] px-6 py-3 text-white">
      <div className="flex w-full items-center justify-between gap-4">
        <Link href="/" aria-label="FountainRank home">
          <Image
            src="/fountainrank-logo.png"
            alt="FountainRank"
            width={480}
            height={205}
            priority
            className="h-9 w-auto"
          />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {totalPoints != null && <HeaderPoints initialTotalPoints={totalPoints} />}
          <AuthControl viewer={viewer} />
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
