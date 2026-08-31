"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  formatLocationFreshness,
  startLocationFreshnessTicker,
} from "../../lib/map/location-freshness";

function subscribeVisibility(onStoreChange: () => void): () => void {
  document.addEventListener("visibilitychange", onStoreChange);
  return () => document.removeEventListener("visibilitychange", onStoreChange);
}

function getVisibilitySnapshot(): DocumentVisibilityState {
  return document.visibilityState;
}

function getServerVisibilitySnapshot(): DocumentVisibilityState {
  return "hidden";
}

/** Owns the per-second display clock so freshness ticks do not reconcile the map. */
export function LocationFreshnessLabel({
  lastSuccessfulFixAtMs,
}: {
  lastSuccessfulFixAtMs: number | null;
}) {
  const visibilityState = useSyncExternalStore(
    subscribeVisibility,
    getVisibilitySnapshot,
    getServerVisibilitySnapshot,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (lastSuccessfulFixAtMs === null || visibilityState !== "visible") return;
    return startLocationFreshnessTicker(() => setNowMs(Date.now()));
  }, [lastSuccessfulFixAtMs, visibilityState]);

  return (
    <div
      aria-live="off"
      className="pointer-events-none absolute right-2 top-40 z-30 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs tabular-nums text-muted shadow"
    >
      {formatLocationFreshness(lastSuccessfulFixAtMs, nowMs)}
    </div>
  );
}
