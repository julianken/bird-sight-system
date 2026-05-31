# Security Policy

`bird-sight-system` powers the public site [bird-maps.com](https://bird-maps.com).
We take security reports seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please report privately — do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and
choose **Report a vulnerability**
([how it works](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

We aim to acknowledge a report within 3 business days and to share a remediation
timeline after triage.

## Scope

In scope:

- The public read API (`api.bird-maps.com`) and the site (`bird-maps.com`).
- The operator **admin API** (`bird-admin-api`) — authentication/authorization handling,
  input validation, and the storage / cache-purge path.
- Secret or credential exposure in this repository or its build/deploy artifacts.

Out of scope:

- Volumetric denial-of-service. The read API is rate-limited by design
  (see [`services/read-api/README.md`](services/read-api/README.md)).
- Findings that require an already-compromised operator bearer token, absent a
  vulnerability in how that token is issued, stored, or validated.
- Vulnerabilities in third-party data sources (eBird, Phylopic, iNaturalist, Wikipedia)
  or infrastructure providers (GCP, Cloudflare).

## No bounty

This is a personal, non-commercial project. We can't offer monetary rewards, but we're
grateful for every report and will credit reporters who wish to be named.
