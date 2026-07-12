"use client";
import { useEffect, useState } from "react";
import { CONTRIBUTION_EVENT, contributionPoints } from "../../lib/contribution-event";
import { WaterCelebration } from "../map/MapStates";

export function ContributionStatusOverlay() {
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [points, setPoints] = useState<number | undefined>(undefined);

  useEffect(() => {
    const onContribution = (e: Event) => {
      const awarded = contributionPoints(e);
      // Saved, but earned nothing -> no celebration (#204). The form still shows a neutral
      // confirmation saying why; this animation is a reward and must not fire for a 0 award.
      if (awarded <= 0) return;
      setPoints(awarded);
      setCelebrationKey((key) => key + 1);
    };
    window.addEventListener(CONTRIBUTION_EVENT, onContribution);
    return () => {
      window.removeEventListener(CONTRIBUTION_EVENT, onContribution);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 bottom-0 z-40">
      <WaterCelebration triggerKey={celebrationKey} points={points} />
    </div>
  );
}
