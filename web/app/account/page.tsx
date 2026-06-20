import { getLogtoContext } from "@logto/next/server-actions";

import { SignInButton } from "../../components/SignInButton";
import { SignOutButton } from "../../components/SignOutButton";
import { getLogtoConfig } from "../../lib/logto";
import { getAuthedApiClient } from "../../lib/server/api";
import { log } from "../../lib/server/log";

export const dynamic = "force-dynamic";

const shell =
  "relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4] px-6 py-16 text-center text-white";

export default async function AccountPage() {
  const { isAuthenticated } = await getLogtoContext(getLogtoConfig(), { fetchUserInfo: false });

  if (!isAuthenticated) {
    return (
      <main className={shell}>
        <h1 className="text-2xl font-bold">Your FountainRank account</h1>
        <p className="max-w-sm text-white/80">Sign in to rate fountains and add new ones.</p>
        <SignInButton />
      </main>
    );
  }

  const requestId = crypto.randomUUID();
  let profile: { display_name: string; email: string; avatar_url: string | null } | null = null;
  try {
    const { data, error, response } = await (await getAuthedApiClient(requestId)).GET("/api/v1/me");
    if (error || !data) {
      log("error", "failed to load profile", { requestId, status: response?.status });
    } else {
      profile = data;
      log("debug", "loaded profile", { requestId, status: response?.status });
    }
  } catch (err) {
    // getAccessTokenRSC()/network can throw on an expired or broken session — render the
    // graceful state instead of an unhandled server error (spec §4.5/§5).
    log("error", "failed to load profile", { requestId, reason: (err as Error).name });
  }

  if (!profile) {
    return (
      <main className={shell}>
        <h1 className="text-2xl font-bold">Couldn&rsquo;t load your profile</h1>
        <p className="max-w-sm text-white/80">Please try signing in again.</p>
        <SignOutButton />
      </main>
    );
  }

  return (
    <main className={shell}>
      <h1 className="text-2xl font-bold">Signed in</h1>
      {profile.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external avatar host; no next/image loader configured
        <img src={profile.avatar_url} alt="" width={64} height={64} className="rounded-full" />
      ) : null}
      <dl className="text-white/90">
        <div className="flex gap-2">
          <dt className="font-semibold">Name:</dt>
          <dd>{profile.display_name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Email:</dt>
          <dd>{profile.email}</dd>
        </div>
      </dl>
      <SignOutButton />
    </main>
  );
}
