"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { components } from "@fountainrank/api-client";
import {
  adminDeleteFountain,
  adminSetFountainHidden,
  adminSetNoteHidden,
  adminUpdateFountainFromForm,
  type AdminActionResult,
} from "../../app/actions/admin";

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
  const message = errorText(result);

  const run = (action: () => Promise<AdminActionResult>, after?: () => void) => {
    setResult(null);
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
    <section className="space-y-4 border-t border-slate-200 pt-4">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0A357E]">Admin controls</h2>
        {detail.is_hidden ? (
          <p className="mt-1 text-xs font-semibold text-amber-700">Hidden from public reads</p>
        ) : null}
        {message ? <p className="mt-2 text-sm text-red-700">{message}</p> : null}
      </div>

      <form
        className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          run(() => adminUpdateFountainFromForm(detail.id, formData));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-semibold text-slate-700">
            <span>Latitude</span>
            <input
              name="latitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              required
              defaultValue={detail.location.latitude}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900"
            />
          </label>
          <label className="space-y-1 text-sm font-semibold text-slate-700">
            <span>Longitude</span>
            <input
              name="longitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              required
              defaultValue={detail.location.longitude}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900"
            />
          </label>
        </div>
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          <span>Status</span>
          <select
            name="is_working"
            defaultValue={detail.is_working ? "true" : "false"}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900"
          >
            <option value="true">Working</option>
            <option value="false">Out of order</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          <span>Placement note</span>
          <textarea
            name="placement_note"
            defaultValue={detail.placement_note ?? ""}
            rows={2}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900"
          />
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          <span>Comments</span>
          <textarea
            name="comments"
            defaultValue={detail.comments ?? ""}
            rows={3}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[#0A357E] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          Save edits
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => adminSetFountainHidden(detail.id, !detail.is_hidden))}
          className="rounded-full border border-[#0A357E] px-4 py-2 text-sm font-bold text-[#0A357E] disabled:opacity-60"
        >
          {detail.is_hidden ? "Unhide fountain" : "Hide fountain"}
        </button>
        {confirmDelete ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => adminDeleteFountain(detail.id),
                  () => router.push("/"),
                )
              }
              className="rounded-full bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              Confirm delete
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
            className="rounded-full border border-red-700 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-60"
          >
            Delete fountain
          </button>
        )}
      </div>

      {detail.notes.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Moderate notes
          </h3>
          <ul className="space-y-2">
            {detail.notes.map((note) => (
              <li
                key={note.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <p className="break-words text-slate-700">{note.body}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {note.author_display_name}
                    {note.is_hidden ? " · hidden" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`${note.is_hidden ? "Unhide" : "Hide"} note ${noteLabel(note)}`}
                  onClick={() => run(() => adminSetNoteHidden(note.id, !note.is_hidden, detail.id))}
                  className="shrink-0 rounded-full border border-[#0A357E] px-3 py-1.5 text-xs font-bold text-[#0A357E] disabled:opacity-60"
                >
                  {note.is_hidden ? "Unhide" : "Hide"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
