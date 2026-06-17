import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "FountainRank",
  description: "Find, rate, and rank public drinking fountains.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
