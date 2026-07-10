"use client";

import { useState, useTransition } from "react";

import { deleteAccount, type DeleteAccountError } from "../../app/actions/profile";

const ERROR_TEXT: Record<DeleteAccountError, string> = {
  unauthenticated: "Your session expired. Please sign in again.",
  server: "Account deletion did not complete. Please try again.",
};

const CONFIRM_TEXT =
  "This permanently deletes your FountainRank account, profile, notes, and photos. Fountain ratings and fountain details you contributed will stay on the public map without your account attached.";

export function DeleteAccountButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!window.confirm(CONFIRM_TEXT)) return;
    start(async () => {
      const result = await deleteAccount();
      if (!result.ok) {
        setError(ERROR_TEXT[result.error]);
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="inline-flex items-center justify-center rounded-full border border-red-200 px-6 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-100 disabled:opacity-50"
      >
        {pending ? "Deleting account..." : "Delete account"}
      </button>
      {error ? (
        <p role="alert" className="max-w-sm text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </div>
  );
}
