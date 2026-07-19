import { DetailOverlay } from "../../../../components/fountain/DetailOverlay";

export default function LoadingFountainDetail() {
  return (
    <DetailOverlay>
      <div role="status" aria-busy="true">
        <p className="font-semibold">Loading fountain details…</p>
        <div
          className="mt-4 h-40 animate-pulse rounded-xl bg-surface motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>
    </DetailOverlay>
  );
}
