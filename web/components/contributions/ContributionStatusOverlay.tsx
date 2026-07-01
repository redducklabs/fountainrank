"use client";
import { useEffect, useState } from "react";
import { WaterCelebration } from "../map/MapStates";

export function ContributionStatusOverlay() {
  const [celebrationKey, setCelebrationKey] = useState(0);

  useEffect(() => {
    const onContribution = () => {
      setCelebrationKey((key) => key + 1);
    };
    window.addEventListener("fountainrank:contribution", onContribution);
    return () => {
      window.removeEventListener("fountainrank:contribution", onContribution);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 bottom-0 z-40">
      <WaterCelebration triggerKey={celebrationKey} />
    </div>
  );
}
