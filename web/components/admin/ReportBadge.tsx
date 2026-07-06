"use client";

import { useEffect, useState } from "react";
import { fetchPendingReportCount } from "../../app/actions/admin";

const POLL_INTERVAL_MS = 60_000;

// Admin-only pending-photo-report count overlaid on the header avatar (style guide
// "Pending-report badge"). Seeded with the server-rendered initial count, then polls the
// `fetchPendingReportCount` server action every ~60s so the token never leaves the server.
// Renders nothing at count 0 — never an empty badge.
export function ReportBadge({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const id = setInterval(() => {
      fetchPendingReportCount()
        .then(setCount)
        .catch(() => {
          // fetchPendingReportCount already degrades to 0 on error; a thrown promise here
          // would only come from an unexpected client-side failure, so just skip this tick.
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  if (count <= 0) return null;

  const display = count > 9 ? "9+" : String(count);
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white dark:bg-red-500"
      >
        {display}
      </span>
      <span className="sr-only">, {count} pending photo reports</span>
    </>
  );
}
