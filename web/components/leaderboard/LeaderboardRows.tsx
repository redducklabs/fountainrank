"use client";

import { useEffect, useRef, useState, type Ref } from "react";

import {
  rowMetricCaption,
  rowPrimaryValue,
  type ContributorRow,
  type LeaderboardSort,
  type YourStanding,
} from "../../lib/leaderboard";

export function LeaderboardRows({
  rows,
  you,
  sort,
}: {
  rows: ContributorRow[];
  you: YourStanding | null;
  sort: LeaderboardSort;
}) {
  const youInList = rows.some((r) => r.is_you);
  const youRowRef = useRef<HTMLLIElement | null>(null);
  // Assume an in-list "You" row is visible until the observer proves otherwise, so the sticky
  // overlay never flashes for someone whose row is already on screen.
  const [youRowVisible, setYouRowVisible] = useState(youInList);

  // Keep the caller's rank visible: when their in-list row scrolls out of view — or they rank
  // below the fetched rows and have no in-list row at all — show a sticky bottom overlay with
  // their standing ("your rank, always"; #147, #117).
  useEffect(() => {
    const el = youRowRef.current;
    if (!el) {
      setYouRowVisible(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setYouRowVisible(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows]);

  return (
    <div className="mt-4 pb-24">
      {rows.length === 0 ? (
        <p className="text-center text-muted">No contributors yet.</p>
      ) : (
        <ol className="divide-y divide-border">
          {rows.map((row) => (
            <Row
              key={`${row.rank}-${row.display_name}`}
              row={row}
              sort={sort}
              innerRef={row.is_you ? youRowRef : undefined}
            />
          ))}
        </ol>
      )}
      {you && (!youInList || !youRowVisible) ? (
        <div
          role="region"
          aria-label="Your current ranking"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur"
        >
          <div className="mx-auto max-w-2xl px-6 py-2">
            <YouRow you={you} sort={sort} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  row,
  sort,
  innerRef,
}: {
  row: ContributorRow;
  sort: LeaderboardSort;
  innerRef?: Ref<HTMLLIElement>;
}) {
  // Rank 1 is the leader of the active category/sort — mark it with a crown (#146).
  const isLeader = row.rank === 1;
  return (
    <li
      ref={innerRef}
      className={
        "flex items-center gap-3 px-3 py-3 " +
        (row.is_you ? "rounded-lg bg-accent-subtle ring-1 ring-brand-mid" : "")
      }
    >
      <RankCell rank={`${row.rank}`} you={row.is_you} />
      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
        {isLeader ? <CrownIcon /> : null}
        {row.display_name}
        {row.is_you ? <YouTag /> : null}
      </span>
      <Metric
        value={rowPrimaryValue(row.points, row.category_count, sort)}
        caption={rowMetricCaption(row.points, sort)}
      />
    </li>
  );
}

function YouRow({ you, sort }: { you: YourStanding; sort: LeaderboardSort }) {
  const ranked = you.rank != null;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-accent-subtle px-3 py-3 ring-1 ring-brand-mid">
      <RankCell rank={ranked ? `${you.rank}` : "—"} you />
      <span className="min-w-0 flex-1 font-semibold text-foreground">
        You
        {ranked ? null : (
          <span className="ml-2 text-xs font-normal text-muted">Not yet ranked</span>
        )}
      </span>
      <Metric
        value={rowPrimaryValue(you.points, you.category_count, sort)}
        caption={rowMetricCaption(you.points, sort)}
      />
    </div>
  );
}

function RankCell({ rank, you }: { rank: string; you: boolean }) {
  return (
    <span
      className={
        "w-8 shrink-0 text-right text-sm font-bold tabular-nums " +
        (you ? "text-brand" : "text-muted")
      }
    >
      {rank}
    </span>
  );
}

function Metric({ value, caption }: { value: number; caption: string }) {
  return (
    <span className="shrink-0 text-right">
      <span className="block text-base font-black tabular-nums text-brand">
        {value.toLocaleString()}
      </span>
      <span className="block text-[11px] text-muted">{caption}</span>
    </span>
  );
}

function YouTag() {
  return (
    <span className="ml-2 rounded bg-brand px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
      You
    </span>
  );
}

// MDI "crown" glyph in crown-gold, matching the mobile MaterialCommunityIcons
// crown so the category-leader marker is visually consistent across platforms (#146).
function CrownIcon() {
  return (
    <svg
      role="img"
      aria-label="Category leader"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      className="mr-1 inline-block align-text-bottom"
    >
      <path
        d="M5,16L3,5L8.5,12L12,4L15.5,12L21,5L19,16H5M19,19A1,1 0 0,1 18,20H6A1,1 0 0,1 5,19V18H19V19Z"
        fill="#F2C200"
      />
    </svg>
  );
}
