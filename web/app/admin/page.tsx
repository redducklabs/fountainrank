import { notFound } from "next/navigation";
import { SiteHeader } from "../../components/SiteHeader";
import { getViewer } from "../../lib/server/viewer";
import { signInWithReturn } from "../actions/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await getViewer(crypto.randomUUID());
  if (viewer.state === "anonymous") {
    // IMPORTANT: do NOT call signInWithReturn() directly here — it mutates cookies, which is
    // only allowed in a Server Action / Route Handler, never during an RSC render. Render a
    // sign-in FORM instead; submitting it runs the action in a valid (cookie-writable) context.
    return (
      <>
        <SiteHeader variant="bar" />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-lg font-bold text-brand-ink">Admin</h1>
          <p className="mt-2 text-muted">Sign in to access the admin tools.</p>
          <form action={signInWithReturn.bind(null, "/admin")} className="mt-3">
            <button
              type="submit"
              className="rounded-full bg-accent-gold px-4 py-2 text-sm font-bold text-brand"
            >
              Sign in
            </button>
          </form>
        </main>
      </>
    );
  }
  if (viewer.state === "error") {
    return (
      <>
        <SiteHeader variant="bar" />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-lg font-bold text-brand-ink">Couldn&rsquo;t verify admin access</h1>
          <p className="mt-2 text-muted">Please try again in a moment.</p>
        </main>
      </>
    );
  }
  if (!viewer.isAdmin) notFound();
  return (
    <>
      <SiteHeader variant="bar" />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-lg font-bold text-brand-ink">Admin</h1>
        <p className="mt-2 text-muted">
          Moderation controls live inline on each fountain detail page.
        </p>
        <p className="mt-4 text-sm text-muted">
          Open a fountain from the map to edit location, status, placement text, visibility,
          deletion, and community-note visibility.
        </p>
      </main>
    </>
  );
}
