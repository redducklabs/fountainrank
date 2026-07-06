"use client";

import { ThemeProvider } from "next-themes";

// next-themes injects a pre-hydration <script> that sets the `.dark` class on <html>
// before first paint, so there is no light→dark flash. `attribute="class"` matches the
// @custom-variant in globals.css; `system` (default) follows the OS until the user picks.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}
