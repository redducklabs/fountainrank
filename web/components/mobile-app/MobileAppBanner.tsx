import type { MobileStoreLink } from "../../lib/mobile-store-links";

export function MobileAppBanner({
  link,
  onDismiss,
}: {
  link: MobileStoreLink;
  onDismiss: () => void;
}) {
  return (
    <aside
      aria-label="Get the FountainRank mobile app"
      className="border-b border-white/10 bg-brand px-4 py-3 text-on-brand shadow-sm"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="text-sm leading-snug">
          <span className="font-semibold">Take FountainRank with you.</span>{" "}
          <span className="text-white/80">Find and rate fountains in the mobile app.</span>
        </p>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${link.label} (opens in a new tab)`}
            className="rounded-full bg-accent-gold px-4 py-2 text-xs font-semibold text-brand transition hover:bg-accent-gold-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold"
          >
            {link.label}
          </a>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss app download banner"
            className="rounded-full border border-white/40 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Dismiss
          </button>
        </div>
      </div>
    </aside>
  );
}
