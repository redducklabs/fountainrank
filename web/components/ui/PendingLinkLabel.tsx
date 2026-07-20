"use client";
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

/** Content rendered inside Next Link; announces and visualizes route pending until commit. */
export function PendingLinkLabel({
  children,
  pendingLabel = "Opening…",
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
}) {
  const { pending } = useLinkStatus();
  return (
    <span className="inline-flex items-center gap-1.5" aria-live="polite" aria-busy={pending}>
      {pending && <Spinner className="h-3.5 w-3.5" />}
      <span>{pending ? pendingLabel : children}</span>
    </span>
  );
}
