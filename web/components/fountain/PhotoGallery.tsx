"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PhotoOut } from "../../lib/fountains";
import { deleteOwnPhoto } from "../../app/actions/contribute";
import { PhotoCarousel } from "./PhotoCarousel";
import { ReportPhotoDialog } from "./ReportPhotoDialog";

// Bridges `PhotoCarousel` (a plain client component, callback props only) to the
// `reportPhoto`/`deleteOwnPhoto` server actions — kept as its own client component so
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
  const [, startDelete] = useTransition();
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
        onDelete={isAuthenticated ? handleDelete : undefined}
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
