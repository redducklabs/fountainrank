import type { Metadata } from "next";

import "./globals.css";

const title = "FountainRank — Find, rate, and rank public drinking fountains";
const description =
  "FountainRank is a community-built map of public drinking fountains. Discover one nearby, rate the ones you love, and help the best rise to the top. Launching soon.";

export const metadata: Metadata = {
  metadataBase: new URL("https://fountainrank.com"),
  title,
  description,
  icons: { icon: "/icon.png" },
  openGraph: {
    title,
    description,
    images: ["/fountainrank-logo.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
