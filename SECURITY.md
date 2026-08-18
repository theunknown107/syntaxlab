# Security Policy

## Reporting a vulnerability

Report privately — please do not open a public issue for a security problem.

- **GitHub Security Advisories** (preferred): use the *Report a vulnerability*
  button on the repository's Security tab.
- If that is unavailable, contact the maintainer directly.

Please include: what you found, how to reproduce it, the browser and version,
and what you believe the impact is. A proof-of-concept helps a great deal.

## What to expect

SyntaxLab is a small, volunteer-maintained project. We do not offer a formal
SLA, and pretending otherwise would be dishonest. What we do commit to:

| Stage | Expectation |
|---|---|
| Acknowledgement | Within a few days |
| Assessment | We will tell you whether we consider it a vulnerability, and why |
| Fix | Deployed as a patch release once validated |
| Disclosure | After the fix is live, with credit if you want it |

## Scope

SyntaxLab is a static, client-only web application. There is no backend, no
database, no user accounts, and no server-side session — so whole categories
of report do not apply here.

**In scope**
- Cross-site scripting or any path that renders user input as markup
- Prototype pollution via parsed JSON, imported files, or stored preferences
- CSS injection via theme values
- Bypassing the input-size or execution limits to hang or crash the tab
- Escaping the Web Worker isolation used for regex execution
- Anything causing the application to make an unexpected network request
- Tampered or corrupted browser storage leading to code execution or a crash
- Malicious import files that are accepted rather than rejected

**Out of scope**
- Browser extensions reading page content. No web page can prevent this, and
  we document it rather than claim otherwise.
- Local access to an unlocked device. History is stored unencrypted; this is
  documented, not a defect.
- Denial of service against the static host.
- Missing headers that do not apply to a static, cookie-free origin.
- Reports produced solely by an automated scanner with no demonstrated impact.

## What we do not claim

We do not describe SyntaxLab as foolproof, unhackable, or completely secure.
Our security posture is defence-in-depth: several independent controls that
each reduce risk. The controls, their limits, and the accepted residual risks
are documented in [docs/05_SECURITY.md](docs/05_SECURITY.md) and
[docs/14_THREAT_MODEL.md](docs/14_THREAT_MODEL.md).

A claim we cannot trace to a passing test does not get published.
