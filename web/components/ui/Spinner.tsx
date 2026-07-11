/**
 * A small, decorative loading spinner (#212). It carries NO accessible name — it is purely
 * visual; the accessible "busy" signal comes from the host control's `aria-busy` (see
 * `SpinnerButton` / `FormSubmitButton`), matching the house rule that an animation must never be
 * the only signal. `text-current` makes it inherit the surrounding text color, so it reads
 * correctly on any button variant. Honors reduced-motion (renders statically, no spin).
 */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin motion-reduce:animate-none text-current ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
