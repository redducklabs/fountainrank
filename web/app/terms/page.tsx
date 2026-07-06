import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | FountainRank",
  description: "Terms of Service for FountainRank.",
  alternates: { canonical: "/terms" },
};

const lastUpdated = "June 19, 2026";

const sections = [
  {
    title: "Using FountainRank",
    body: [
      "You may use FountainRank to browse, rate, review, report, and contribute information about public drinking fountains.",
      "You are responsible for your account and for activity that occurs through it.",
      "You must use the service lawfully and must not interfere with, abuse, scrape, disrupt, or attempt to bypass security for the service.",
    ],
  },
  {
    title: "Safety and Access",
    body: [
      "FountainRank is informational. Fountain locations, working status, quality ratings, and other community submissions may be incomplete, outdated, or inaccurate.",
      "Use your own judgment before visiting or using a fountain. Do not trespass, enter unsafe areas, violate posted rules, or put yourself or others at risk to add or verify a fountain.",
      "FountainRank does not guarantee water quality, availability, accessibility, or safety.",
    ],
  },
  {
    title: "User Content",
    body: [
      "You are responsible for ratings, comments, photos, reports, and other content you submit.",
      "Do not submit content that is unlawful, misleading, abusive, infringing, invasive of privacy, or otherwise harmful.",
      "By submitting content, you give FountainRank a worldwide, non-exclusive, royalty-free license to host, copy, display, modify, distribute, and use that content to operate, improve, promote, and protect the service.",
      "We may remove or moderate content, restrict accounts, or take other action when we believe content or activity violates these Terms or creates risk for the service or community.",
    ],
  },
  {
    title: "Accounts and Authentication",
    body: [
      "Some features require an account. You must provide accurate account information and keep your sign-in credentials secure.",
      "We may suspend or terminate access if we believe an account is being misused, compromised, or used in violation of these Terms.",
    ],
  },
  {
    title: "Intellectual Property",
    body: [
      "FountainRank, including its name, branding, interface, software, and service design, is owned by FountainRank or its licensors.",
      "These Terms do not grant you ownership of FountainRank or permission to use its branding except as needed to identify the service.",
    ],
  },
  {
    title: "Service Changes",
    body: [
      "FountainRank is under active development. We may add, change, restrict, or discontinue features at any time.",
      "We may update these Terms as the service changes. Continued use after updated Terms become effective means you accept the updated Terms.",
    ],
  },
  {
    title: "Disclaimers",
    body: [
      "FountainRank is provided as is and as available, without warranties of any kind to the fullest extent permitted by law.",
      "We do not warrant that the service will be uninterrupted, secure, error-free, or that community-submitted information will be accurate.",
    ],
  },
  {
    title: "Limitation of Liability",
    body: [
      "To the fullest extent permitted by law, FountainRank and its operators will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, data, goodwill, or other intangible losses arising from your use of the service.",
    ],
  },
  {
    title: "Contact",
    body: ["For questions about these Terms, contact privacy@fountainrank.com."],
  },
];

export default function TermsOfService() {
  return (
    <main className="min-h-dvh bg-surface-raised px-6 py-10 text-foreground sm:py-14">
      <article className="mx-auto max-w-3xl">
        <Link
          className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          href="/"
        >
          FountainRank
        </Link>

        <header className="mt-10 border-b border-border pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink">
            Terms of Service
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-normal text-foreground">
            FountainRank Terms of Service
          </h1>
          <p className="mt-4 text-sm text-muted">Last updated: {lastUpdated}</p>
          <p className="mt-6 text-base leading-7 text-foreground">
            These Terms govern your use of FountainRank, a community-built service for finding,
            rating, and sharing public drinking fountains.
          </p>
        </header>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold text-foreground">{section.title}</h2>
              <ul className="mt-3 list-disc space-y-2 pl-6 text-base leading-7 text-foreground">
                {section.body.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
