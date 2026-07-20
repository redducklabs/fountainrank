"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  adminDeleteFountain,
  adminDeletePhoto,
  adminDismissReport,
  adminHidePhoto,
  adminSetFountainHidden,
  adminSetNoteHidden,
  type AdminActionResult,
  type AdminContentType,
} from "../../app/actions/admin";
import { SpinnerButton } from "../ui/SpinnerButton";

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
      return "This item no longer exists.";
    default:
      return "The admin action failed.";
  }
}

// Per-type moderation actions for one queue row (#12). Photo: Hide/Reject/Delete;
// note: Hide/Reject (hide IS the removal); fountain: Hide/Reject/Delete. Reject uses the
// generalized dismiss for every type.
export function ReportedContentActions({
  contentType,
  contentId,
  fountainId,
  isHidden,
}: {
  contentType: AdminContentType;
  contentId: string;
  fountainId: string;
  isHidden: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moderationReason, setModerationReason] = useState("");
  // Which action is in flight, so only the tapped button spins while `pending` disables the whole
  // row (single-flight). The local Cancel / initial-Delete toggles never spin.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const message = errorText(result);

  const run = (key: string, action: () => Promise<AdminActionResult>) => {
    setResult(null);
    setActiveKey(key);
    startTransition(async () => {
      const next = await action();
      setResult(next);
      if (next.ok) {
        router.refresh();
      }
    });
  };

  const hide = (): Promise<AdminActionResult> => {
    const reason = moderationReason.trim() || undefined;
    if (contentType === "photo")
      return reason
        ? adminHidePhoto(contentId, !isHidden, reason)
        : adminHidePhoto(contentId, !isHidden);
    if (contentType === "note")
      return reason
        ? adminSetNoteHidden(contentId, !isHidden, fountainId, reason)
        : adminSetNoteHidden(contentId, !isHidden, fountainId);
    return reason
      ? adminSetFountainHidden(contentId, !isHidden, reason)
      : adminSetFountainHidden(contentId, !isHidden);
  };

  // Only photo and fountain support a hard delete; a note's removal is a Hide.
  const deleteAction =
    contentType === "photo"
      ? () =>
          moderationReason.trim()
            ? adminDeletePhoto(contentId, moderationReason)
            : adminDeletePhoto(contentId)
      : contentType === "fountain"
        ? () =>
            moderationReason.trim()
              ? adminDeleteFountain(contentId, moderationReason)
              : adminDeleteFountain(contentId)
        : null;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <input
        value={moderationReason}
        onChange={(event) => setModerationReason(event.target.value)}
        maxLength={500}
        placeholder="Moderation reason (optional)"
        aria-label="Moderation reason"
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground sm:w-56"
      />
      <div className="flex gap-2">
        <SpinnerButton
          pending={pending && activeKey === "hide"}
          disabled={pending}
          onClick={() => run("hide", hide)}
          className="rounded-full border border-brand px-3 py-1.5 text-xs font-semibold text-brand-ink hover:bg-brand/5 disabled:opacity-60"
        >
          {isHidden ? "Unhide" : "Hide"}
        </SpinnerButton>
        <SpinnerButton
          pending={pending && activeKey === "reject"}
          disabled={pending}
          onClick={() =>
            run("reject", () =>
              moderationReason.trim()
                ? adminDismissReport(contentType, contentId, moderationReason)
                : adminDismissReport(contentType, contentId),
            )
          }
          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface disabled:opacity-60"
        >
          Reject
        </SpinnerButton>
        {deleteAction &&
          (confirmDelete ? (
            <>
              <SpinnerButton
                pending={pending && activeKey === "delete"}
                disabled={pending}
                onClick={() => run("delete", deleteAction)}
                className="rounded-full bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 dark:bg-red-500"
              >
                Confirm delete
              </SpinnerButton>
              <SpinnerButton
                pending={false}
                disabled={pending}
                onClick={() => setConfirmDelete(false)}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-60"
              >
                Cancel
              </SpinnerButton>
            </>
          ) : (
            <SpinnerButton
              pending={false}
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
              className="rounded-full border border-danger px-3 py-1.5 text-xs font-semibold text-danger hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-500/10"
            >
              Delete
            </SpinnerButton>
          ))}
      </div>
      {message ? <p className="text-xs text-danger">{message}</p> : null}
    </div>
  );
}
