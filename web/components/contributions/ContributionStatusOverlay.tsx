"use client";
import { useEffect, useState } from "react";
import { getMyContributionStats } from "../../app/actions/contributions";
import { PointsBadge, WaterCelebration } from "../map/MapStates";

export function ContributionStatusOverlay({ initialTotalPoints }: { initialTotalPoints: number }) {
  const [totalPoints, setTotalPoints] = useState(initialTotalPoints);
  const [celebrationKey, setCelebrationKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function refreshPoints() {
      const result = await getMyContributionStats();
      if (cancelled || !result.ok) return;
      setTotalPoints(result.totalPoints);
      setCelebrationKey((key) => key + 1);
    }
    const onContribution = () => void refreshPoints();
    window.addEventListener("fountainrank:contribution", onContribution);
    return () => {
      cancelled = true;
      window.removeEventListener("fountainrank:contribution", onContribution);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <PointsBadge total={totalPoints} />
      <WaterCelebration triggerKey={celebrationKey} />
    </div>
  );
}
