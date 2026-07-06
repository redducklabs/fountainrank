"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  adminDeletePhoto,
  adminDismissPhotoReports,
  adminHidePhoto,
  type AdminActionResult,
} from "../../app/actions/admin";

function errorText(result: AdminActionResult | null): string | null {
  if (!result || result.ok) return null;
  switch (result.error) {
    case "unauthenticated":
      return "Sign in again before moderating.";
    case "forbidden":
      return "This account does not have admin access.";
    case "validation":
      return "Check the values and try again.";
    case "not_found":
      return "This photo no longer exists.";
    default:
      return "The admin action failed.";
  }
}

export function ReportedPhotoActions({
  photoId,
  isHidden,
}: {
  photoId: string;
  isHidden: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const message = errorText(result);

  const run = (action: () => Promise<AdminActionResult>) => {
    setResult(null);
    startTransition(async () => {
      const next = await action();
      setResult(next);
      if (next.ok) {
        router.refresh();
      }
    });
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => adminHidePhoto(photoId, !isHidden))}
          className="rounded-full border border-brand px-3 py-1.5 text-xs font-semibold text-brand-ink hover:bg-brand/5 disabled:opacity-60"
        >
          {isHidden ? "Unhide" : "Hide"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => adminDismissPhotoReports(photoId))}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface disabled:opacity-60"
        >
          Reject
        </button>
        {confirmDelete ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => adminDeletePhoto(photoId))}
              className="rounded-full bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 dark:bg-red-500"
            >
              Confirm delete
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
            className="rounded-full border border-danger px-3 py-1.5 text-xs font-semibold text-danger hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-500/10"
          >
            Delete
          </button>
        )}
      </div>
      {message ? <p className="text-xs text-danger">{message}</p> : null}
    </div>
  );
}
