import Link from "next/link";

import { DisplayNameForm } from "../../../components/account/DisplayNameForm";
import { FountainList } from "../../../components/fountain/FountainList";
import { SignInButton } from "../../../components/SignInButton";
import { SignOutButton } from "../../../components/SignOutButton";
import { SiteHeader } from "../../../components/SiteHeader";
import type { FountainPin } from "../../../lib/fountains";
import { resolveAccountGate } from "../../../lib/server/account-gate";
import { getAuthedApiClient } from "../../../lib/server/api";
import { log } from "../../../lib/server/log";

export const dynamic = "force-dynamic";

const darkShell =
  "relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-brand via-brand-mid to-brand-royal px-6 py-16 text-center text-white";
const listShell = "mx-auto min-h-dvh max-w-2xl bg-surface-raised px-6 py-10";

export default async function MyFountainsPage() {
  const requestId = crypto.randomUUID();
  const gate = await resolveAccountGate(requestId);

  // Same gate states as the account page — a name-less user is held at `needs-name` here too.
  if (gate.status === "unauthenticated") {
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={darkShell}>
          <h1 className="text-2xl font-bold">Your rated fountains</h1>
          <p className="max-w-sm text-white/80">
            Sign in to see the fountains you&rsquo;ve added and rated.
          </p>
          <SignInButton />
        </main>
      </>
    );
  }
  if (gate.status === "no-profile") {
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={darkShell}>
          <h1 className="text-2xl font-bold">Couldn&rsquo;t load your profile</h1>
          <p className="max-w-sm text-white/80">Please try signing in again.</p>
          <SignOutButton />
        </main>
      </>
    );
  }
  if (gate.status === "needs-name") {
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={darkShell}>
          <DisplayNameForm initialValue="" required />
          <SignOutButton />
        </main>
      </>
    );
  }

  // gate.status === "ready": load the caller's contributed fountains. `null` = fetch failed
  // (graceful state), an array (possibly empty) = success.
  let fountains: FountainPin[] | null = null;
  try {
    const { data, error, response } = await (
      await getAuthedApiClient(requestId)
    ).GET("/api/v1/me/fountains");
    if (error || !data) {
      log("error", "failed to load my fountains", { requestId, status: response?.status });
    } else {
      fountains = data.fountains;
    }
  } catch (err) {
    log("error", "failed to load my fountains", { requestId, reason: (err as Error).name });
  }

  return (
    <>
      <SiteHeader variant="bar" />
      <main className={listShell}>
        <Link href="/account" className="text-sm text-brand-ink underline">
          ← Back to your account
        </Link>
        <h1 className="mt-6 text-2xl font-black text-brand-ink">
          Fountains you&rsquo;ve added or rated
        </h1>
        {fountains === null ? (
          <p className="mt-6 text-muted">Couldn&rsquo;t load your fountains. Please try again.</p>
        ) : fountains.length > 0 ? (
          <FountainList fountains={fountains} />
        ) : (
          <p className="mt-6 text-muted">
            You haven&rsquo;t added or rated any fountains yet.{" "}
            <Link href="/" className="text-brand-ink underline">
              Find one on the map.
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
