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
    <button
      onClick={onClick}
      aria-live="polite"
      className="rounded-full border border-border bg-surface-raised px-4 py-2 text-sm font-bold text-brand"
    >
      {label}
    </button>
  );
}
