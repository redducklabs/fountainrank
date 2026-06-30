import type { Metadata } from "next";

import { AnalyticsConsent } from "../components/analytics/AnalyticsConsent";
import "./globals.css";

const title = "FountainRank — Find drinking fountains near you";
const description =
  "A free, community map of public drinking fountains. See what's nearby, what's working, and how people rate it.";

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

export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        {modal}
        <AnalyticsConsent />
      </body>
    </html>
  );
}
