"use client";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "copied" | "error";

export function ShareButton() {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (s: Status) => {
    setStatus(s);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2000);
  };

  const onClick = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ url: window.location.href });
      } else {
        // Desktop has no share sheet — copy the link and SHOW that it happened, so the
        // button no longer looks like it does nothing (#168).
        await navigator.clipboard.writeText(window.location.href);
        flash("copied");
      }
    } catch (err) {
      // A user-cancelled native share sheet is an AbortError — stay idle, not an error.
      if ((err as Error)?.name !== "AbortError") flash("error");
    }
  };

  const label =
    status === "copied" ? "Link copied!" : status === "error" ? "Couldn't copy" : "Share";
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        aria-label="Share this fountain"
        title="Share this fountain"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-raised text-brand-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 10.6 6.8-4.2M8.6 13.4l6.8 4.2" />
        </svg>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "idle" ? "" : label}
      </span>
    </span>
  );
}
