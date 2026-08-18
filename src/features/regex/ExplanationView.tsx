import type { Explanation, ExplanationNode } from '@/domain/shared/explanation';
import type { SourceSpan } from '@/domain/shared/result';
import styles from './regex.module.css';

/**
 * Renders `ExplanationNode[]` — 03_DOMAIN_MODEL.md §2.4, ADR-011
 *
 * Every branch below emits a React text child. There is no HTML string, no
 * markdown pass, and no `dangerouslySetInnerHTML` anywhere in this path, which
 * is the whole reason explanations are a tree of typed segments rather than a
 * string: user syntax reaches the DOM as a text node, so there is no injection
 * point to sanitise on the product's highest-frequency operation.
 *
 * The renderer also never *composes* an explanation. If a sentence reads
 * badly, the fix belongs in `domain/regex/explain.ts` where it can be reviewed
 * and pinned by the golden corpus — not patched into the view, where two
 * different explanations would exist for the same pattern.
 */

export interface SpanLinkHandlers {
  readonly onHover: (span: SourceSpan | null) => void;
  readonly onSelect: (span: SourceSpan) => void;
}

interface NodesProps {
  readonly nodes: readonly ExplanationNode[];
  readonly links: SpanLinkHandlers;
}

export function ExplanationNodes({ nodes, links }: NodesProps): React.JSX.Element {
  return (
    <>
      {nodes.map((node, index) => (
        <ExplanationSegment key={index} node={node} links={links} />
      ))}
    </>
  );
}

function ExplanationSegment({
  node,
  links,
}: {
  node: ExplanationNode;
  links: SpanLinkHandlers;
}): React.JSX.Element {
  switch (node.kind) {
    case 'text':
      return <>{node.value}</>;

    case 'emphasis':
      return <em className={styles.emphasis}>{node.value}</em>;

    case 'code':
      return <code className={styles.code}>{node.value}</code>;

    case 'ref':
      // A real button, so the link between explanation and source is reachable
      // by keyboard rather than by hover only (08_UI_UX_SPEC.md §12.1).
      return (
        <button
          type="button"
          className={styles.ref}
          onMouseEnter={() => {
            links.onHover(node.span);
          }}
          onMouseLeave={() => {
            links.onHover(null);
          }}
          onFocus={() => {
            links.onHover(node.span);
          }}
          onBlur={() => {
            links.onHover(null);
          }}
          onClick={() => {
            links.onSelect(node.span);
          }}
          aria-label={`${node.value} — at position ${node.span.start} in the pattern`}
        >
          {node.value}
        </button>
      );

    case 'list':
      return (
        <ul className={styles.explanationList}>
          {node.items.map((item, index) => (
            <li key={index}>
              <ExplanationNodes nodes={item} links={links} />
            </li>
          ))}
        </ul>
      );
  }
}

interface ExplanationViewProps {
  readonly explanation: Explanation;
  readonly links: SpanLinkHandlers;
}

export function ExplanationView({ explanation, links }: ExplanationViewProps): React.JSX.Element {
  return (
    <div className={styles.explanation}>
      <p className={styles.summary}>
        <ExplanationNodes nodes={explanation.summary} links={links} />
      </p>

      {explanation.details.length > 0 && (
        <ol className={styles.sections}>
          {explanation.details.map((section) => (
            <li key={section.id} className={styles.section}>
              {section.span === undefined ? (
                <span className={styles.sectionTitle}>{section.title}</span>
              ) : (
                // The bidirectional explanation-to-source link
                // (08_UI_UX_SPEC.md §7.1). A button rather than a hover
                // target, so it works from the keyboard as well as the mouse.
                <button
                  type="button"
                  className={styles.sectionLink}
                  onMouseEnter={() => {
                    links.onHover(section.span ?? null);
                  }}
                  onMouseLeave={() => {
                    links.onHover(null);
                  }}
                  onFocus={() => {
                    links.onHover(section.span ?? null);
                  }}
                  onBlur={() => {
                    links.onHover(null);
                  }}
                  onClick={() => {
                    if (section.span) links.onSelect(section.span);
                  }}
                  aria-label={`${section.title} — at position ${section.span.start} in the pattern`}
                >
                  {section.title}
                </button>
              )}
              <span className={styles.sectionBody}>
                <ExplanationNodes nodes={section.body} links={links} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
