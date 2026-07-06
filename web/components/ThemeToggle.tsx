"use client";

import { useId, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

type Choice = "system" | "light" | "dark";
const CHOICES: { value: Choice; label: string; glyph: string }[] = [
  { value: "system", label: "System", glyph: "🖥" },
  { value: "light", label: "Light", glyph: "☀" },
  { value: "dark", label: "Dark", glyph: "🌙" },
];

function subscribeMounted(): () => void {
  return () => {};
}

function getMountedSnapshot(): boolean {
  return true;
}

function getServerMountedSnapshot(): boolean {
  return false;
}

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // SSR-safe mount detection via useSyncExternalStore — NOT a mount useEffect+setState, which
  // the project's react-hooks/set-state-in-effect lint rule forbids (see AnalyticsConsent.tsx
  // for the established pattern). The server snapshot is always `false`, so the server render
  // and the first client paint both render the placeholder below (no hydration mismatch); the
  // client snapshot is `true`, so React flips to the real toggle right after mount.
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
  // Unique radio-group name PER INSTANCE — the account page renders TWO toggles (header +
  // body); a shared `name` would merge them into one native radio group and break selection
  // + keyboard nav. useId() is SSR-stable, so no hydration mismatch.
  const groupName = useId();

  const base =
    "inline-flex items-center rounded-full border border-white/30 bg-white/10 p-0.5 text-white";

  // Until mounted, `theme` is not reliable (SSR) — render a same-size, non-interactive
  // placeholder so there is no layout shift and no hydration mismatch.
  if (!mounted) {
    return <div className={base} aria-hidden="true" style={{ height: 32, width: 96 }} />;
  }

  // Preflight resets <fieldset> margin/border/padding to 0, so `base` styles it cleanly.
  return (
    <fieldset className={base}>
      <legend className="sr-only">Theme</legend>
      {CHOICES.map((c) => (
        <label
          key={c.value}
          title={c.label}
          className="flex h-7 w-8 cursor-pointer items-center justify-center rounded-full text-sm transition hover:bg-white/10 has-[:checked]:bg-white/25 has-[:checked]:font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/70"
        >
          <input
            type="radio"
            name={groupName}
            value={c.value}
            checked={theme === c.value}
            onChange={() => setTheme(c.value)}
            aria-label={c.label}
            className="sr-only"
          />
          <span aria-hidden="true">{c.glyph}</span>
        </label>
      ))}
    </fieldset>
  );
}
