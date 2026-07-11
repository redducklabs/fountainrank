"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PhotoOut } from "../../lib/fountains";
import { deleteOwnPhoto } from "../../app/actions/contribute";
import { PhotoCarousel } from "./PhotoCarousel";
import { ReportContentDialog } from "./ReportContentDialog";
import { REPORT_CATEGORIES } from "./reportCategories";

// Bridges `PhotoCarousel` (a plain client component, callback props only) to the
// `reportContent`/`deleteOwnPhoto` server actions — kept as its own client component so
// `FountainDetail` can stay a server component (matches the ContributeSection boundary).
export function PhotoGallery({
  fountainId,
  photos,
  isAuthenticated,
}: {
  fountainId: string;
  photos: PhotoOut[];
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [reportPhotoId, setReportPhotoId] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, startDelete] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  if (photos.length === 0) return null;

  function handleDelete(photo: PhotoOut) {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this photo? This can't be undone.")
    ) {
      return;
    }
    setDeleteMsg(null);
    setDeletingId(photo.id);
    startDelete(async () => {
      const res = await deleteOwnPhoto(fountainId, photo.id);
      if (res.ok) {
        router.refresh();
      } else {
        setDeleteMsg("Couldn't delete this photo — please try again.");
      }
      setDeletingId(null);
    });
  }

  return (
    <div>
      <PhotoCarousel
        photos={photos}
        onDelete={isAuthenticated ? handleDelete : undefined}
        onReport={isAuthenticated ? (photo) => setReportPhotoId(photo.id) : undefined}
        deletePending={pending}
        deletingPhotoId={deletingId}
      />
      {deleteMsg && (
        <p role="status" aria-live="polite" className="mt-1 text-sm text-danger">
          {deleteMsg}
        </p>
      )}
      {reportPhotoId && (
        <ReportContentDialog
          contentType="photo"
          fountainId={fountainId}
          contentId={reportPhotoId}
          categories={REPORT_CATEGORIES.photo}
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
