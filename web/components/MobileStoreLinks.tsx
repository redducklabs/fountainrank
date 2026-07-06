import { resolveMobileStoreLinks } from "../lib/mobile-store-links";

export function MobileStoreLinks() {
  const links = resolveMobileStoreLinks();
  if (links.length === 0) return null;

  return (
    <nav aria-label="Download the mobile app" className="flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <a
          key={link.store}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${link.label} (opens in a new tab)`}
          className="inline-flex min-h-10 items-center rounded-lg border border-white/30 bg-black/25 px-3 py-2 text-xs font-bold leading-tight text-white transition hover:border-white hover:bg-black/35 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
