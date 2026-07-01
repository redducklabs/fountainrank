"use client";
import { useEffect, useState } from "react";
import { getMyContributionStats } from "../app/actions/contributions";
import { PointsBadge } from "./map/MapStates";

export function HeaderPoints({ initialTotalPoints }: { initialTotalPoints: number }) {
  const [totalPoints, setTotalPoints] = useState(initialTotalPoints);

  useEffect(() => {
    let cancelled = false;
    async function refreshPoints() {
      const result = await getMyContributionStats();
      if (cancelled || !result.ok) return;
      setTotalPoints(result.totalPoints);
    }
    const onContribution = () => void refreshPoints();
    window.addEventListener("fountainrank:contribution", onContribution);
    return () => {
      cancelled = true;
      window.removeEventListener("fountainrank:contribution", onContribution);
    };
  }, []);

  return (
    <PointsBadge
      total={totalPoints}
      href="/leaderboard"
      className="hidden min-w-20 rounded-lg border-2 border-[#F2C200] bg-[#0A357E] px-3 py-1.5 text-center text-white shadow outline-none transition hover:border-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 sm:block motion-safe:animate-[points-pop_420ms_ease-out]"
    />
  );
}
