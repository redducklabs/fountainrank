"use client";
import { signInWithReturn } from "../../app/actions/auth";

const FAB_CLASS =
  "absolute bottom-24 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-accent-gold px-4 py-3 text-sm font-bold text-brand shadow-lg transition hover:bg-accent-gold-hover";

export function AddFountainFab({
  isAuthenticated,
  webglOk,
  onEnter,
}: {
  isAuthenticated: boolean;
  webglOk: boolean;
  onEnter: () => void;
}) {
  if (!webglOk) return null; // no map -> no placement
  if (!isAuthenticated) {
    return (
      <form action={signInWithReturn.bind(null, "/?add=1")} className="contents">
        <button type="submit" className={FAB_CLASS} aria-label="Add a fountain">
          <span aria-hidden="true">+</span> Add a fountain
        </button>
      </form>
    );
  }
  return (
    <button type="button" onClick={onEnter} className={FAB_CLASS} aria-label="Add a fountain">
      <span aria-hidden="true">+</span> Add a fountain
    </button>
  );
}
