import { afterEach, describe, expect, it } from 'vitest';

import { analyzeCron } from '@/domain/cron/analyze';
import {
  buildSchedule,
  nextOccurrences,
  resolveInstant,
  wallClockOf,
  type ScheduleModel,
} from '@/domain/cron/schedule';

/**
 * Daylight saving — 04_PARSER_ARCHITECTURE.md §4.6
 *
 * The policy is documented and is followed here rather than chosen:
 *
 *  - **Spring forward.** A local reading the clock jumped over never occurs.
 *    Report it as `skipped` and say that schedulers differ — most skip, some
 *    fire an hour later. Do not pick one and present it as the answer.
 *  - **Fall back.** A local reading the clock fell back through occurs twice.
 *    Report it as `repeated` **with both instants and their offsets**, rather
 *    than silently collapsing them.
 *
 * `process.env.TZ` is honoured by `Date` at runtime in Node, so these run
 * against real zone rules from the platform's own database rather than against
 * a stub of them. Each test restores the original.
 */

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

function withZone<T>(zone: string, read: () => T): T {
  process.env.TZ = zone;
  return read();
}

function schedule(source: string): ScheduleModel {
  const analysis = analyzeCron(source, { timezoneMode: 'browserLocal' });
  if (!analysis.ok) throw new Error(`${source} did not analyse`);
  const built = buildSchedule(analysis.value);
  if (!built.ok) throw new Error(`${source} did not build: ${built.reason}`);
  return built.schedule;
}

/* ------------------------------------------------------------------ *
 * Resolving a wall clock to instants
 * ------------------------------------------------------------------ */

describe('a local reading that does not exist', () => {
  it('is reported as skipped, in a zone that springs forward', () => {
    // Europe/London, 29 March 2026: 01:00 becomes 02:00. There is no 01:30.
    const resolution = withZone('Europe/London', () =>
      resolveInstant({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, 'browserLocal'),
    );
    expect(resolution.kind).toBe('skipped');
  });

  it('is reported as skipped in the southern hemisphere too', () => {
    // Australia/Sydney springs forward on 4 October 2026: 02:00 → 03:00.
    const resolution = withZone('Australia/Sydney', () =>
      resolveInstant({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, 'browserLocal'),
    );
    expect(resolution.kind).toBe('skipped');
  });

  it('resolves the readings on either side of the gap normally', () => {
    withZone('Europe/London', () => {
      const before = resolveInstant(
        { year: 2026, month: 3, day: 29, hour: 0, minute: 30 },
        'browserLocal',
      );
      const after = resolveInstant(
        { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
        'browserLocal',
      );
      expect(before.kind).toBe('unique');
      expect(after.kind).toBe('unique');
      // And the offsets differ across the transition — GMT then BST.
      if (before.kind === 'unique' && after.kind === 'unique') {
        expect(before.offsetMinutes).toBe(0);
        expect(after.offsetMinutes).toBe(60);
      }
    });
  });
});

describe('a local reading that happens twice', () => {
  it('is reported as repeated, with both instants and their offsets', () => {
    // Europe/London, 25 October 2026: 02:00 becomes 01:00. 01:30 happens twice.
    const resolution = withZone('Europe/London', () =>
      resolveInstant({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, 'browserLocal'),
    );
    expect(resolution.kind).toBe('repeated');
    if (resolution.kind !== 'repeated') return;

    expect(resolution.instants).toHaveLength(2);
    const [first, second] = resolution.instants;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;

    // Exactly an hour apart, and the offsets say which is which: BST then GMT.
    expect(second.epochMs - first.epochMs).toBe(3_600_000);
    expect(first.offsetMinutes).toBe(60);
    expect(second.offsetMinutes).toBe(0);
    // Both really do read as 01:30 locally — that is what "twice" means.
    for (const instant of resolution.instants) {
      const wall = wallClockOf(instant.epochMs, 'browserLocal');
      expect(wall.hour).toBe(1);
      expect(wall.minute).toBe(30);
    }
  });
});

describe('a zone with no transitions', () => {
  it('resolves every reading uniquely, all year', () => {
    withZone('Asia/Kolkata', () => {
      for (const [month, day] of [
        [3, 29],
        [10, 25],
        [1, 1],
        [7, 15],
      ] as [number, number][]) {
        const resolution = resolveInstant(
          { year: 2026, month, day, hour: 1, minute: 30 },
          'browserLocal',
        );
        expect(resolution.kind, `${String(month)}/${String(day)}`).toBe('unique');
        // +05:30, which is also the check that the probe handles half-hour
        // offsets rather than assuming whole hours.
        if (resolution.kind === 'unique') expect(resolution.offsetMinutes).toBe(330);
      }
    });
  });
});

describe('UTC', () => {
  it('never has an anomaly, in any zone the machine happens to be in', () => {
    for (const zone of ['Europe/London', 'Australia/Sydney', 'Asia/Kolkata', 'UTC']) {
      const resolution = withZone(zone, () =>
        resolveInstant({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, 'utc'),
      );
      expect(resolution.kind, zone).toBe('unique');
      if (resolution.kind === 'unique') {
        expect(resolution.offsetMinutes, zone).toBe(0);
        expect(new Date(resolution.epochMs).toISOString()).toBe('2026-03-29T01:30:00.000Z');
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Anomalies through the schedule engine
 * ------------------------------------------------------------------ */

describe('a schedule that lands in the gap', () => {
  it('returns the run marked skipped, with no instant invented for it', () => {
    const search = withZone('Europe/London', () =>
      nextOccurrences(schedule('30 1 * * *'), {
        mode: 'browserLocal',
        after: Date.parse('2026-03-28T12:00:00Z'),
        count: 3,
      }),
    );
    expect(search.ok).toBe(true);
    if (!search.ok) return;

    const skipped = search.occurrences.find((occurrence) => occurrence.anomaly === 'skipped');
    expect(skipped).toBeDefined();
    if (!skipped) return;

    expect(skipped.wall).toMatchObject({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 });
    // The whole point: no instant, because there is none.
    expect(skipped.epochMs).toBeNull();
    expect(skipped.offsetMinutes).toBeNull();
  });

  it('keeps producing real runs on the days either side', () => {
    const search = withZone('Europe/London', () =>
      nextOccurrences(schedule('30 1 * * *'), {
        mode: 'browserLocal',
        after: Date.parse('2026-03-27T12:00:00Z'),
        count: 4,
      }),
    );
    expect(search.ok).toBe(true);
    if (!search.ok) return;

    // 28th real, 29th skipped, 30th and 31st real. A skipped reading must not
    // end the search or shift the ones after it.
    expect(search.occurrences.map((occurrence) => occurrence.wall.day)).toEqual([28, 29, 30, 31]);
    expect(search.occurrences.map((occurrence) => occurrence.anomaly)).toEqual([
      undefined,
      'skipped',
      undefined,
      undefined,
    ]);
  });
});

describe('a schedule that lands in the repeated hour', () => {
  it('returns the run marked repeated, carrying both instants', () => {
    const search = withZone('Europe/London', () =>
      nextOccurrences(schedule('30 1 * * *'), {
        mode: 'browserLocal',
        after: Date.parse('2026-10-24T12:00:00Z'),
        count: 3,
      }),
    );
    expect(search.ok).toBe(true);
    if (!search.ok) return;

    const repeated = search.occurrences.find((occurrence) => occurrence.anomaly === 'repeated');
    expect(repeated).toBeDefined();
    if (!repeated) return;

    expect(repeated.wall).toMatchObject({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 });
    expect(repeated.repeatedInstants).toHaveLength(2);
    // The earlier instant is the one a scheduler firing once would use, and it
    // is reported as the occurrence — with the other kept alongside rather
    // than silently discarded.
    expect(repeated.epochMs).toBe(repeated.repeatedInstants?.[0]?.epochMs);
    expect(repeated.offsetMinutes).toBe(60);
  });
});

describe('a schedule away from any transition', () => {
  it('carries no anomaly at all', () => {
    const search = withZone('Europe/London', () =>
      nextOccurrences(schedule('30 1 * * *'), {
        mode: 'browserLocal',
        after: Date.parse('2026-06-01T12:00:00Z'),
        count: 3,
      }),
    );
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    for (const occurrence of search.occurrences) {
      expect(occurrence.anomaly).toBeUndefined();
      expect(occurrence.epochMs).not.toBeNull();
      expect(occurrence.offsetMinutes).toBe(60); // BST
    }
  });
});

/* ------------------------------------------------------------------ *
 * The machine's own zone must not leak into UTC answers
 * ------------------------------------------------------------------ */

describe('UTC mode is independent of the machine', () => {
  it.each([
    ['Europe/London'],
    ['Australia/Sydney'],
    ['Asia/Kolkata'],
    ['America/New_York'],
    ['UTC'],
    ['Pacific/Kiritimati'],
  ])('gives the same answer in %s', (zone) => {
    const search = withZone(zone, () =>
      nextOccurrences(schedule('30 1 * * *'), {
        mode: 'utc',
        after: Date.parse('2026-03-28T12:00:00Z'),
        count: 2,
      }),
    );
    expect(search.ok, zone).toBe(true);
    if (!search.ok) return;
    expect(
      search.occurrences.map((occurrence) =>
        occurrence.epochMs === null ? null : new Date(occurrence.epochMs).toISOString(),
      ),
      zone,
    ).toEqual(['2026-03-29T01:30:00.000Z', '2026-03-30T01:30:00.000Z']);
  });
});
