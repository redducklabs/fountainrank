import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | FountainRank",
  description: "Privacy Policy for FountainRank.",
  alternates: { canonical: "/privacy" },
};

const lastUpdated = "June 30, 2026";

const sections = [
  {
    title: "Information We Collect",
    body: [
      "Account information, such as your email address, display name, and sign-in provider identifiers when you create or use an account.",
      "Fountain contributions, such as fountain locations, ratings, comments, reports, and photos you choose to submit.",
      "Approximate or precise location information when you allow the app or website to use your device location to find nearby fountains or add a fountain. You can control location permissions in your browser or device settings.",
      "Technical information, such as device, browser, IP address, request logs, diagnostics, and security events needed to operate, secure, and debug the service.",
      "Authentication and email delivery information processed through our sign-in providers and email systems, such as Google, Apple, and Logto.",
    ],
  },
  {
    title: "How We Use Information",
    body: [
      "Provide the map, fountain listings, ratings, account features, and other FountainRank functionality.",
      "Authenticate users, protect accounts, prevent abuse, and maintain service security.",
      "Store and display community submissions, including ratings, comments, fountain details, and photos.",
      "Improve reliability, diagnose issues, respond to support requests, and understand aggregate product usage.",
      "Send transactional messages related to authentication, account access, and service operation.",
    ],
  },
  {
    title: "Sharing",
    body: [
      "Public fountain data may be visible to other users and visitors, including submitted fountain locations, ratings, comments, and photos.",
      "We use service providers to host, authenticate, store, deliver email, and operate FountainRank. These providers process information only as needed to provide their services to us.",
      "We may disclose information if required by law, to protect rights and safety, or to investigate abuse, security incidents, or violations of our Terms.",
      "We do not sell personal information.",
    ],
  },
  {
    title: "Analytics",
    body: [
      "We use Google Analytics 4 to understand, in aggregate, how FountainRank is used (for example, which pages are visited). It is loaded only after you accept the analytics consent banner; if you decline, it is never loaded and sets no cookies.",
      "We send only the page path to Google Analytics. Query strings are stripped from both the page address and the referring page before anything is sent, so details such as your approximate map location are not shared with Google.",
      "Google Analytics may collect standard usage information such as device and browser type, an approximate location that Google derives from your IP address, and the pages viewed. We do not send Google any account identifiers.",
      "You can change your choice at any time by clearing this site's stored data in your browser, which removes the saved analytics choice and shows the banner again on your next visit.",
    ],
  },
  {
    title: "Data Retention",
    body: [
      "We keep account information while your account is active or as needed to operate the service.",
      "Community submissions may remain available after account deletion when needed to preserve the usefulness and integrity of the public fountain map, unless removal is required by law or appropriate for safety, privacy, or moderation reasons.",
      "Logs and diagnostics are kept for a limited period appropriate for security, debugging, and operations.",
    ],
  },
  {
    title: "Your Choices",
    body: [
      "You can choose not to create an account, but rating, adding fountains, uploading photos, and some other features require sign-in.",
      "You can disable location access through your browser or device settings.",
      "You can request access, correction, deletion, or export of personal information by contacting us.",
      "You can stop receiving non-essential communications if any are offered. Transactional authentication and security messages may still be sent when needed.",
    ],
  },
  {
    title: "Children",
    body: [
      "FountainRank is not directed to children under 13, and children under 13 should not create an account or submit personal information.",
      "We do not knowingly collect personal information from children under 13. If we learn that we have collected personal information from a child under 13, we will delete it as required by the Children's Online Privacy Protection Act (COPPA).",
      "A parent or legal guardian who believes their child under 13 provided personal information may contact privacy@fountainrank.com to request review, deletion, or refusal of further collection or use of that child's information.",
    ],
  },
  {
    title: "Changes",
    body: [
      "We may update this Privacy Policy as FountainRank changes. If changes are material, we will provide notice through the service or another reasonable method.",
    ],
  },
  {
    title: "Contact",
    body: ["For privacy questions or requests, contact privacy@fountainrank.com."],
  },
];

export default function PrivacyPolicy() {
  return (
    <main className="min-h-dvh bg-surface-raised px-6 py-10 text-foreground sm:py-14">
      <article className="mx-auto max-w-3xl">
        <Link
          className="text-sm font-medium text-brand-mid underline-offset-4 hover:underline"
          href="/"
        >
          FountainRank
        </Link>

        <header className="mt-10 border-b border-border pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-mid">
            Privacy Policy
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-normal text-foreground">
            FountainRank Privacy Policy
          </h1>
          <p className="mt-4 text-sm text-muted">Last updated: {lastUpdated}</p>
          <p className="mt-6 text-base leading-7 text-foreground">
            FountainRank is a community-built map for finding, rating, and sharing public drinking
            fountains. This policy explains what information we collect, how we use it, and the
            choices you have.
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
