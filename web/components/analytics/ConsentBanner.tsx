"use client";

import Link from "next/link";

// A fixed bottom consent bar (presentational). The parent (AnalyticsConsent) owns the consent state
// and only renders this when a choice is still pending. Accept loads GA; Decline loads nothing.
export function ConsentBanner({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-brand px-4 py-3 text-white shadow-[0_-4px_16px_rgba(0,0,0,0.25)]"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-white/90">
          We use privacy-respecting analytics to understand how FountainRank is used. We only ever
          send the page path — never your query strings. See our{" "}
          <Link
            href="/privacy"
            className="font-semibold underline underline-offset-4 hover:text-white"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onDecline}
            className="rounded-full border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-full bg-accent-gold px-5 py-2 text-sm font-semibold text-brand transition hover:bg-accent-gold-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
