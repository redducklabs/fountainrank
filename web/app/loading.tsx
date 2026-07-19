export default function Loading() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-map-canvas"
      role="status"
      aria-busy="true"
    >
      <p className="rounded-full bg-surface-raised px-5 py-3 text-sm shadow">
        Loading FountainRank…
      </p>
    </main>
  );
}
