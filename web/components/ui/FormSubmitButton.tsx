"use client";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

/**
 * A submit button for server-action `<form action={…}>` surfaces (sign in / sign out / anonymous
 * sign-in CTAs) that have no `useTransition` (#212). It reads the parent form's pending state via
 * `useFormStatus`, so it MUST be rendered as a descendant of the `<form>`. While the action is
 * pending it shows a `<Spinner />`, sets `aria-busy`, and disables itself. Mirrors `SpinnerButton`
 * but with form-driven pending.
 */
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  /** Optional label swap shown while pending (e.g. "Signing in…"); defaults to `children`. */
  pendingLabel?: ReactNode;
  spinnerClassName?: string;
};

export function FormSubmitButton({
  pendingLabel,
  spinnerClassName,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className={`inline-flex items-center justify-center gap-2 ${className ?? ""}`}
    >
      {pending && <Spinner className={spinnerClassName} />}
      <span>{pending && pendingLabel != null ? pendingLabel : children}</span>
    </button>
  );
}
