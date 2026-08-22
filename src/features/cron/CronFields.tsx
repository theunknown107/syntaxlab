import type { CronAnalysis, CronField } from '@/domain/cron/ast';
import { CRON_FIELD_SPECS } from '@/domain/cron/ast';
import type { SpanLinkHandlers } from '@/components/ExplanationView';

import styles from './cron.module.css';

/**
 * The field breakdown — 08_UI_UX_SPEC.md §7.3
 *
 * Five rows, always in the same order, whether or not the expression parsed.
 * A cron expression *is* five positional fields, and the commonest mistake
 * with one is losing track of which position you are editing; a table that
 * appears only on success would vanish exactly when that help is needed.
 *
 * Every row carries its name in words. Colour marks the failing row, but it is
 * never the only signal — the row says "out of range" too (08_UI_UX_SPEC.md
 * §12.1).
 */

/** How many resolved values to list before giving the count instead. */
const MAX_LISTED = 12;

function resolvedText(field: CronField): string {
  if (field.error !== undefined) return '—';
  if (field.isWildcard) return 'every value';
  if (field.resolved.length > MAX_LISTED) return `${String(field.resolved.length)} values`;
  return field.resolved.join(', ');
}

interface CronFieldsProps {
  readonly analysis: CronAnalysis;
  readonly links: SpanLinkHandlers;
}

export function CronFields({ analysis, links }: CronFieldsProps): React.JSX.Element {
  if (analysis.fields.length === 0) {
    // `@reboot` is the case that reaches this. It has no clock schedule, and
    // five placeholder rows would imply one.
    return (
      <p className={styles.noFields}>
        This expression has no clock fields. See the explanation below.
      </p>
    );
  }

  return (
    <table className={styles.fields}>
      <caption className={styles.srOnly}>
        The five fields of the expression, in order, with the values each one selects
      </caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Wrote</th>
          <th scope="col">Selects</th>
        </tr>
      </thead>
      <tbody>
        {analysis.fields.map((field) => {
          const spec = CRON_FIELD_SPECS[field.name];
          const error = field.error;
          return (
            <tr key={field.name} className={error === undefined ? undefined : styles.fieldRowError}>
              <th scope="row" className={styles.fieldName}>
                {spec.label}
                <span className={styles.fieldRange}>
                  {spec.min}–{spec.max}
                </span>
              </th>
              <td>
                <button
                  type="button"
                  className={styles.fieldRaw}
                  onMouseEnter={() => {
                    links.onHover(field.span);
                  }}
                  onMouseLeave={() => {
                    links.onHover(null);
                  }}
                  onFocus={() => {
                    links.onHover(field.span);
                  }}
                  onBlur={() => {
                    links.onHover(null);
                  }}
                  onClick={() => {
                    links.onSelect(field.span);
                  }}
                  aria-label={`${spec.label}: ${field.raw}. Show it in the expression.`}
                >
                  {field.raw}
                </button>
              </td>
              <td className={styles.fieldResolved}>
                {error === undefined ? (
                  resolvedText(field)
                ) : (
                  // The message, not a colour. Someone who cannot see the row
                  // tint still learns what is wrong with this field.
                  <span className={styles.fieldError}>{error.message}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
