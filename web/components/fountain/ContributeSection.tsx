"use client";
import type { components } from "@fountainrank/api-client";
import { signInWithReturn } from "../../app/actions/auth";
import { FormSubmitButton } from "../ui/FormSubmitButton";
import { AttributeForm } from "./AttributeForm";
import { RatingForm } from "./RatingForm";
import { ConditionForm } from "./ConditionForm";
import { NoteForm } from "./NoteForm";
import { PhotoUpload } from "./PhotoUpload";

type Dimension = components["schemas"]["DimensionSummary"];

export function ContributeSection({
  fountainId,
  dimensions,
  isAuthenticated,
  conditionPointsEligibleAt,
  variant = "primary",
}: {
  fountainId: string;
  dimensions: Dimension[];
  isAuthenticated: boolean;
  conditionPointsEligibleAt?: string | null;
  variant?: "primary" | "details" | "photos";
}) {
  const signInMessage =
    variant === "photos"
      ? "Sign in to add a photo to this fountain."
      : "Sign in to rate this fountain, report its status, or leave a note.";
  return (
    <section className="border-t border-border pt-4">
      <h2 className="text-sm font-bold text-brand-ink">Contribute</h2>
      {!isAuthenticated ? (
        <form action={signInWithReturn.bind(null, `/fountains/${fountainId}`)} className="mt-2">
          <p className="text-sm text-muted">{signInMessage}</p>
          <FormSubmitButton className="mt-2 rounded-full bg-accent-gold px-4 py-2 text-sm font-bold text-brand">
            Sign in to contribute
          </FormSubmitButton>
        </form>
      ) : (
        <div className="mt-2 space-y-4">
          {variant === "primary" ? (
            <>
              <RatingForm fountainId={fountainId} dimensions={dimensions} />
              <PhotoUpload fountainId={fountainId} />
            </>
          ) : variant === "photos" ? (
            <PhotoUpload fountainId={fountainId} />
          ) : (
            <>
              <AttributeForm fountainId={fountainId} />
              <ConditionForm
                fountainId={fountainId}
                conditionPointsEligibleAt={conditionPointsEligibleAt}
              />
              <NoteForm fountainId={fountainId} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
