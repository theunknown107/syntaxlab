/**
 * Worked examples — 08_UI_UX_SPEC.md §7.1
 *
 * Each loads a pattern *and* a representative test string. A pattern with an
 * empty tester teaches half of what the tool can show, and the test string is
 * where a user sees the difference between what they meant and what the
 * pattern actually does.
 *
 * These are illustrative, not authoritative. The email one in particular is
 * the shape people write, not a validator — which is exactly why it is a
 * useful thing to have explained.
 */
export interface RegexExample {
  readonly id: string;
  readonly label: string;
  readonly pattern: string;
  readonly flags: string;
  readonly subject: string;
}

export const EXAMPLES: readonly RegexExample[] = [
  {
    id: 'email',
    label: 'Email address',
    pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}',
    flags: 'g',
    subject: 'Write to ada@example.com or to support+billing@mail.example.co.uk.',
  },
  {
    id: 'url',
    label: 'URL',
    pattern: 'https?://[\\w.-]+(?:/[\\w./?%&=-]*)?',
    flags: 'g',
    subject: 'See https://example.com/docs?page=2 and http://localhost:5173/ for details.',
  },
  {
    id: 'iso-date',
    label: 'ISO date',
    pattern: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})',
    flags: 'g',
    subject: 'Released 2026-08-18, superseding 2025-11-02.',
  },
  {
    id: 'ipv4',
    label: 'IPv4 address',
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    flags: 'g',
    subject:
      'Hosts 192.168.0.14 and 10.0.0.255 answered. So does 999.1.1.1 — this pattern checks the shape, not the range.',
  },
  {
    id: 'semver',
    label: 'Semantic version',
    pattern: '^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([\\w.]+))?$',
    flags: '',
    subject: '2.14.0-beta.3',
  },
  {
    id: 'uuid',
    label: 'UUID',
    pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',
    flags: 'gi',
    subject: 'id=3f2504e0-4f89-11d3-9a0c-0305e82c3301 created=now',
  },
  {
    id: 'hex-colour',
    label: 'Hex colour',
    pattern: '#(?:[0-9a-f]{3}|[0-9a-f]{6})\\b',
    flags: 'gi',
    subject: 'Accent #00ff88, surface #101613, shorthand #0f8.',
  },
  {
    id: 'log-line',
    label: 'Log line',
    pattern: '^(?<level>WARN|ERROR|INFO)\\s+(?<time>[\\d:]+)\\s+(?<message>.+)$',
    flags: 'gm',
    subject:
      'INFO  09:14:02 worker started\nERROR 09:14:07 analysis failed\nWARN  09:15:00 retrying',
  },
];
