import { getLogtoContext } from "@logto/next/server-actions";

import { DisplayNameForm } from "../../components/account/DisplayNameForm";
import { SignInButton } from "../../components/SignInButton";
import { SignOutButton } from "../../components/SignOutButton";
import { SiteHeader } from "../../components/SiteHeader";
import { getLogtoConfig } from "../../lib/logto";
import { getAuthedApiClient } from "../../lib/server/api";
import { log } from "../../lib/server/log";
import { syncProfile } from "../../lib/server/sync";
import { isDisplayableEmail } from "../../lib/email";

export const dynamic = "force-dynamic";

const shell =
  "relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4] px-6 py-16 text-center text-white";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Only ever compared to a fixed literal — the raw value is never rendered (no injection).
  const { error } = await searchParams;
  const { isAuthenticated } = await getLogtoContext(getLogtoConfig(), { fetchUserInfo: false });

  if (!isAuthenticated) {
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          {error === "signin" ? (
            <p className="rounded-md bg-white/10 px-4 py-2 text-sm text-white/90">
              Sign-in didn&rsquo;t complete. Please try again.
            </p>
          ) : null}
          <h1 className="text-2xl font-bold">Your FountainRank account</h1>
          <p className="max-w-sm text-white/80">Sign in to rate fountains and add new ones.</p>
          <SignInButton />
        </main>
      </>
    );
  }

  const requestId = crypto.randomUUID();
  // Best-effort: refresh the stored profile from Logto before reading it (never throws).
  await syncProfile(requestId);
  let profile: {
    display_name: string;
    email: string;
    avatar_url: string | null;
    needs_name: boolean;
  } | null = null;
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
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          <h1 className="text-2xl font-bold">Couldn&rsquo;t load your profile</h1>
          <p className="max-w-sm text-white/80">Please try signing in again.</p>
          <SignOutButton />
        </main>
      </>
    );
  }

  // First-sign-in gate: when the account still resolves to "Anonymous", require a name before
  // anything else. The raw subject never reaches here (the API sends display_name="" when needs_name).
  if (profile.needs_name) {
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          <DisplayNameForm initialValue="" required />
          <SignOutButton />
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader variant="bar" />
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
          {isDisplayableEmail(profile.email) && (
            <div className="flex gap-2">
              <dt className="font-semibold">Email:</dt>
              <dd>{profile.email}</dd>
            </div>
          )}
        </dl>
        <DisplayNameForm initialValue={profile.display_name} required={false} />
        <SignOutButton />
      </main>
    </>
  );
}
