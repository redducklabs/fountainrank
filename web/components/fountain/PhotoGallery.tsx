"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PhotoOut } from "../../lib/fountains";
import { deleteOwnPhoto } from "../../app/actions/contribute";
import { PhotoCarousel } from "./PhotoCarousel";
import { ReportPhotoDialog } from "./ReportPhotoDialog";

// Mirrors `backend/app/display.py`'s `ANONYMOUS_DISPLAY_NAME` — the public-safe fallback name
// for an account with no real nickname/IdP name. No shared TS constant exists for it (the web
// app has no generated binding for a backend literal), so it's inlined here as a plain string.
const ANONYMOUS_DISPLAY_NAME = "Anonymous";

// Bridges `PhotoCarousel` (a plain client component, callback props only) to the
// `reportPhoto`/`deleteOwnPhoto` server actions — kept as its own client component so
// `FountainDetail` can stay a server component (matches the ContributeSection boundary).
export function PhotoGallery({
  fountainId,
  photos,
  isAuthenticated,
  viewerDisplayName,
}: {
  fountainId: string;
  photos: PhotoOut[];
  isAuthenticated: boolean;
  // The viewer's own PUBLIC display name (from `/me`), used ONLY as a best-effort UI signal
  // for whether to offer the delete affordance — see `isOwnedByViewer` below.
  viewerDisplayName?: string | null;
}) {
  const router = useRouter();
  const [reportPhotoId, setReportPhotoId] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<ReadonlySet<string>>(new Set());
  const [, startDelete] = useTransition();
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  if (photos.length === 0) return null;

  // Best-effort ONLY: `PhotoOut.uploaded_by` is the uploader's public display name — no
  // stable user id is exposed to the client (spec §11 `PhotoOut`), so this can false-positive
  // when two accounts share a display name. Deliberately excludes the shared "Anonymous"
  // fallback (`ANONYMOUS_DISPLAY_NAME`), which many distinct accounts resolve to, since that
  // would show every anonymous uploader's photo as deletable to every other anonymous viewer.
  // The server is the authoritative check: a delete by a non-owner still 403s
  // (`not_photo_owner`) and the caller just sees the generic "Couldn't delete" message below.
  function isOwnedByViewer(photo: PhotoOut): boolean {
    return (
      !!viewerDisplayName &&
      viewerDisplayName !== ANONYMOUS_DISPLAY_NAME &&
      photo.uploaded_by === viewerDisplayName
    );
  }

  // `PhotoCarousel` takes a single `isOwner` boolean (not a per-photo predicate) that applies
  // to whichever photo the carousel currently shows internally — it doesn't expose its active
  // index to the parent. Passing "true" here means the delete control CAN show even on a
  // photo the viewer doesn't own; the `onDelete` callback below still receives the correct
  // `current` photo, so an accidental click on someone else's photo just surfaces the
  // generic delete-failed message from the 403 rather than silently doing the wrong thing.
  const mayOwnSomething = isAuthenticated && photos.some(isOwnedByViewer);

  function handleDelete(photo: PhotoOut) {
    if (typeof window !== "undefined" && !window.confirm("Delete this photo? This can't be undone.")) {
      return;
    }
    setDeleteMsg(null);
    startDelete(async () => {
      const res = await deleteOwnPhoto(fountainId, photo.id);
      if (res.ok) {
        router.refresh();
      } else {
        setDeleteMsg("Couldn't delete this photo — please try again.");
      }
    });
  }

  return (
    <div>
      <PhotoCarousel
        photos={photos}
        isOwner={mayOwnSomething}
        onDelete={mayOwnSomething ? handleDelete : undefined}
        onReport={isAuthenticated ? (photo) => setReportPhotoId(photo.id) : undefined}
      />
      {deleteMsg && (
        <p role="status" aria-live="polite" className="mt-1 text-sm text-red-700">
          {deleteMsg}
        </p>
      )}
      {reportPhotoId && (
        <ReportPhotoDialog
          fountainId={fountainId}
          photoId={reportPhotoId}
          alreadyReported={reportedIds.has(reportPhotoId)}
          onClose={() => setReportPhotoId(null)}
          onReported={() => {
            const id = reportPhotoId;
            setReportedIds((current) => new Set(current).add(id));
          }}
        />
      )}
    </div>
  );
}
