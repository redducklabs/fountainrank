import Image from "next/image";
import Link from "next/link";
import { AuthControl } from "./AuthControl";
import { getViewer } from "../lib/server/viewer";

export async function SiteHeader({ variant }: { variant: "hero" | "bar" }) {
  const requestId = crypto.randomUUID();
  const viewer = await getViewer(requestId);
  return (
    <header className="bg-gradient-to-b from-[#0A357E] to-[#0E4DA4] px-6 py-3 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
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
        <AuthControl viewer={viewer} />
      </div>
      {variant === "hero" && (
        <p className="mx-auto mt-2 max-w-6xl text-sm font-semibold sm:text-base">
          Find a drinking fountain near you.
        </p>
      )}
    </header>
  );
}
