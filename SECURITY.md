# Security Policy

FountainRank is an open-source project. We take the security of the application
and its users seriously and appreciate responsible disclosure.

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report privately through either channel:

- **GitHub Security Advisories** — use the **"Report a vulnerability"** button on
  the repository's **Security** tab (preferred).
- **Email** — `security@fountainrank.com`.

Please include enough detail to reproduce the issue: affected component
(backend, web, mobile, infrastructure), steps to reproduce, impact, and any
relevant logs or proof-of-concept.

## Response Targets

- **Acknowledgement:** within 3 business days.
- **Initial triage / severity assessment:** within 7 business days.

We will keep you informed of progress and coordinate a disclosure timeline once
a fix is available.

## Supported Versions

This project is pre-release and under active development. Only the latest commit
on the `main` branch is supported. Fixes are applied to `main`; there are no
backported release branches yet.

## Scope

**In scope:**

- The FountainRank backend (`backend/`)
- The web application (`web/`)
- The native mobile applications (`mobile/`)
- Infrastructure-as-code in this repository (`infra/`)

**Out of scope:**

- Third-party services and their infrastructure (DigitalOcean, the upstream
  Logto project, Google, Apple, map tile/data providers)
- Denial-of-service / volumetric attacks
- Social engineering of maintainers or users
- Reports from automated scanners without a demonstrated, exploitable impact

## Safe Harbor

We will not pursue legal action against researchers who, in good faith,
discover and report vulnerabilities in accordance with this policy, avoid
privacy violations and service degradation, and do not access or modify data
beyond what is necessary to demonstrate the issue.
