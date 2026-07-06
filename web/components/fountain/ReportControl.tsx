"use client";
import { useState } from "react";
import { ReportContentDialog } from "./ReportContentDialog";
import type { ReportContentType } from "./reportCategories";

// The trigger affordance that opens `ReportContentDialog` for a note or the fountain itself
// (#11) — the photo path keeps its own carousel-overlay Report chip in `PhotoCarousel`. Owns
// the dialog open state and the session-only `reported` flag for this single item (there is no
// "did I already report this" read endpoint), mirroring how `PhotoGallery` tracks reported
// photos. Render this only for a signed-in viewer — the parent auth-gates it, same as the
// photo Report control and the rest of Contribute.
export function ReportControl({
  contentType,
  fountainId,
  contentId,
  categories,
  label = "Report",
  className = "text-xs font-semibold text-muted hover:text-foreground",
}: {
  contentType: ReportContentType;
  fountainId: string;
  contentId: string;
  categories: readonly string[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {open && (
        <ReportContentDialog
          contentType={contentType}
          fountainId={fountainId}
          contentId={contentId}
          categories={categories}
          alreadyReported={reported}
          onClose={() => setOpen(false)}
          onReported={() => setReported(true)}
        />
      )}
    </>
  );
}
