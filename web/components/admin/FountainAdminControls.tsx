"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { components } from "@fountainrank/api-client";
import {
  adminDeleteFountain,
  adminDeleteRating,
  adminSetFountainHidden,
  adminSetNoteHidden,
  adminUpdateFountainFromForm,
  type AdminActionResult,
} from "../../app/actions/admin";
import { SpinnerButton } from "../ui/SpinnerButton";

type AdminFountainDetail = components["schemas"]["AdminFountainDetail"];
type AdminNoteOut = components["schemas"]["AdminNoteOut"];

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

function noteLabel(note: AdminNoteOut): string {
  return `${note.author_display_name}: ${note.body.slice(0, 80)}`;
}

export function FountainAdminControls({ detail }: { detail: AdminFountainDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRatingId, setConfirmRatingId] = useState<string | null>(null);
  const [moderationReason, setModerationReason] = useState("");
  // Which action is in flight, so only the tapped button spins while `pending` disables the whole
  // group (single-flight). Local toggles (Cancel / the initial Delete affordance) never spin.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const message = errorText(result);

  const run = (key: string, action: () => Promise<AdminActionResult>, after?: () => void) => {
    setResult(null);
    setActiveKey(key);
    startTransition(async () => {
      const next = await action();
      setResult(next);
      if (next.ok) {
        after?.();
        router.refresh();
      }
    });
  };

  return (
    <section className="space-y-4 border-t border-border pt-4">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-ink">Admin controls</h2>
        {detail.is_hidden ? (
          <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
            Hidden from public reads
          </p>
        ) : null}
        {message ? <p className="mt-2 text-sm text-danger">{message}</p> : null}
      </div>

      <form
        className="space-y-3 rounded-lg border border-border bg-surface p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          run("save", () => adminUpdateFountainFromForm(detail.id, formData));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-semibold text-foreground">
            <span>Latitude</span>
            <input
              name="latitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              required
              defaultValue={detail.location.latitude}
              className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-normal text-foreground"
            />
          </label>
          <label className="space-y-1 text-sm font-semibold text-foreground">
            <span>Longitude</span>
            <input
              name="longitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              required
              defaultValue={detail.location.longitude}
              className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-normal text-foreground"
            />
          </label>
        </div>
        <label className="space-y-1 text-sm font-semibold text-foreground">
          <span>Status</span>
          <select
            name="is_working"
            defaultValue={detail.is_working ? "true" : "false"}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-normal text-foreground"
          >
            <option value="true">Working</option>
            <option value="false">Out of order</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold text-foreground">
          <span>Placement note</span>
          <textarea
            name="placement_note"
            defaultValue={detail.placement_note ?? ""}
            rows={2}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-normal text-foreground"
          />
        </label>
        <label className="space-y-1 text-sm font-semibold text-foreground">
          <span>Comments</span>
          <textarea
            name="comments"
            defaultValue={detail.comments ?? ""}
            rows={3}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-normal text-foreground"
          />
        </label>
        <SpinnerButton
          pending={pending && activeKey === "save"}
          disabled={pending}
          type="submit"
          className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          Save edits
        </SpinnerButton>
      </form>

      <label className="block space-y-1 text-sm font-semibold text-foreground">
        <span>Moderation reason</span>
        <textarea
          value={moderationReason}
          onChange={(event) => setModerationReason(event.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Required for rating removal; optional for other moderation actions"
          className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-normal text-foreground"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <SpinnerButton
          pending={pending && activeKey === "hide"}
          disabled={pending}
          onClick={() =>
            run("hide", () =>
              adminSetFountainHidden(detail.id, !detail.is_hidden, moderationReason),
            )
          }
          className="rounded-full border border-brand px-4 py-2 text-sm font-bold text-brand-ink disabled:opacity-60"
        >
          {detail.is_hidden ? "Unhide fountain" : "Hide fountain"}
        </SpinnerButton>
        {confirmDelete ? (
          <>
            <SpinnerButton
              pending={pending && activeKey === "delete"}
              disabled={pending}
              onClick={() =>
                run(
                  "delete",
                  () => adminDeleteFountain(detail.id, moderationReason),
                  () => router.push("/"),
                )
              }
              className="rounded-full bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60 dark:bg-red-500"
            >
              Confirm delete
            </SpinnerButton>
            <SpinnerButton
              pending={false}
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
              className="rounded-full border border-border px-4 py-2 text-sm font-bold text-foreground disabled:opacity-60"
            >
              Cancel
            </SpinnerButton>
          </>
        ) : (
          <SpinnerButton
            pending={false}
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
            className="rounded-full border border-danger px-4 py-2 text-sm font-bold text-danger disabled:opacity-60"
          >
            Delete fountain
          </SpinnerButton>
        )}
      </div>

      {detail.notes.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Moderate notes
          </h3>
          <ul className="space-y-2">
            {detail.notes.map((note) => (
              <li
                key={note.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 text-sm sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <p className="break-words text-foreground">{note.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {note.author_display_name}
                    {note.is_hidden ? " · hidden" : ""}
                  </p>
                </div>
                <SpinnerButton
                  pending={pending && activeKey === `note:${note.id}`}
                  disabled={pending}
                  aria-label={`${note.is_hidden ? "Unhide" : "Hide"} note ${noteLabel(note)}`}
                  onClick={() =>
                    run(`note:${note.id}`, () =>
                      adminSetNoteHidden(note.id, !note.is_hidden, detail.id, moderationReason),
                    )
                  }
                  className="shrink-0 rounded-full border border-brand px-3 py-1.5 text-xs font-bold text-brand-ink disabled:opacity-60"
                >
                  {note.is_hidden ? "Unhide" : "Hide"}
                </SpinnerButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail.ratings.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Moderate ratings
          </h3>
          <ul className="space-y-2">
            {detail.ratings.map((rating) => (
              <li
                key={rating.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-foreground">
                  {rating.rating_type_name}: {rating.stars}/5 · {rating.contributor}
                </p>
                {confirmRatingId === rating.id ? (
                  <div className="flex shrink-0 gap-2">
                    <SpinnerButton
                      pending={pending && activeKey === `rating:${rating.id}`}
                      disabled={pending || moderationReason.trim().length === 0}
                      onClick={() =>
                        run(
                          `rating:${rating.id}`,
                          () => adminDeleteRating(rating.id, detail.id, moderationReason),
                          () => setConfirmRatingId(null),
                        )
                      }
                      className="rounded-full bg-red-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60 dark:bg-red-500"
                    >
                      Confirm removal
                    </SpinnerButton>
                    <SpinnerButton
                      pending={false}
                      disabled={pending}
                      onClick={() => setConfirmRatingId(null)}
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-bold text-foreground disabled:opacity-60"
                    >
                      Cancel
                    </SpinnerButton>
                  </div>
                ) : (
                  <SpinnerButton
                    pending={false}
                    disabled={pending || moderationReason.trim().length === 0}
                    onClick={() => setConfirmRatingId(rating.id)}
                    className="shrink-0 rounded-full border border-danger px-3 py-1.5 text-xs font-bold text-danger disabled:opacity-60"
                  >
                    Remove rating
                  </SpinnerButton>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
