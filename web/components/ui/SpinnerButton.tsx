import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

/**
 * A `<button>` that shows an immediate loading spinner while a `useTransition`/async action is in
 * flight (#212). It standardizes the pending affordance for the app's server-touching controls:
 *
 * - renders a `<Spinner />` the instant `pending` is true (the caller drives `pending` from its
 *   transition's `pending` flag, which flips synchronously on the click — so feedback is instant);
 * - sets `aria-busy` so assistive tech announces the busy state;
 * - forces `disabled` while pending, so the double-submit guard can never be forgotten.
 *
 * Callers keep their own Tailwind classes (brand / gold / emerald / admin variants); this only
 * layers the flex layout, spinner, and a11y on top. For server-action `<form>` submits use
 * `FormSubmitButton` (which reads `useFormStatus`) instead.
 */
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending: boolean;
  /** Optional label swap shown while pending (e.g. "Saving…"); defaults to `children`. */
  pendingLabel?: ReactNode;
  spinnerClassName?: string;
};

export function SpinnerButton({
  pending,
  pendingLabel,
  spinnerClassName,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending}
      className={`inline-flex items-center justify-center gap-2 ${className ?? ""}`}
    >
      {pending && <Spinner className={spinnerClassName} />}
      <span>{pending && pendingLabel != null ? pendingLabel : children}</span>
    </button>
  );
}
