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
  // Render the empty state and the pinned "You" row together: the board can be empty (no one has a
  // positive metric) while a signed-in caller still has a standing — "Your rank, always" (#117).
  const youInList = rows.some((r) => r.is_you);
  return (
    <div className="mt-4">
      {rows.length === 0 ? (
        <p className="text-center text-slate-500">No contributors yet.</p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {rows.map((row) => (
            <Row key={`${row.rank}-${row.display_name}`} row={row} sort={sort} />
          ))}
        </ol>
      )}
      {you && !youInList ? (
        <div className="mt-3 border-t-2 border-dashed border-slate-200 pt-3">
          <YouRow you={you} sort={sort} />
        </div>
      ) : null}
    </div>
  );
}

function Row({ row, sort }: { row: ContributorRow; sort: LeaderboardSort }) {
  return (
    <li
      className={
        "flex items-center gap-3 px-3 py-3 " +
        (row.is_you ? "rounded-lg bg-[#EAF1FF] ring-1 ring-[#0C44A0]" : "")
      }
    >
      <RankCell rank={`${row.rank}`} you={row.is_you} />
      <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">
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
    <div className="flex items-center gap-3 rounded-lg bg-[#EAF1FF] px-3 py-3 ring-1 ring-[#0C44A0]">
      <RankCell rank={ranked ? `${you.rank}` : "—"} you />
      <span className="min-w-0 flex-1 font-semibold text-slate-800">
        You
        {ranked ? null : (
          <span className="ml-2 text-xs font-normal text-slate-500">Not yet ranked</span>
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
        (you ? "text-[#0A357E]" : "text-slate-400")
      }
    >
      {rank}
    </span>
  );
}

function Metric({ value, caption }: { value: number; caption: string }) {
  return (
    <span className="shrink-0 text-right">
      <span className="block text-base font-black tabular-nums text-[#0A357E]">
        {value.toLocaleString()}
      </span>
      <span className="block text-[11px] text-slate-500">{caption}</span>
    </span>
  );
}

function YouTag() {
  return (
    <span className="ml-2 rounded bg-[#0A357E] px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
      You
    </span>
  );
}
