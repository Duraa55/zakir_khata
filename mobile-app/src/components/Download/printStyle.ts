import { color } from '../../theme/tokens';

/**
 * THE print design for every generated document — book reports, the Khata export and
 * the bill invoice. Built from tokens.ts values (no colour is typed here), so paper
 * and screen are one design:
 *   • ink text on white, hairline rules, no shadows or coloured headers;
 *   • colour carries meaning only — green money in, red money out/owed, amber attention;
 *   • two weights (400 / 500), sentence case, figures right-aligned and never wrapped.
 */
export const PRINT_STYLE = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: ${color.textPrimary}; background: ${color.surface};
    margin: 0; padding: 32px; font-size: 13px; font-weight: 400; line-height: 1.45;
  }
  strong, b, th { font-weight: 500; }
  .doc-head {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
    padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid ${color.border};
  }
  .doc-business { font-size: 20px; font-weight: 500; margin: 0; }
  .doc-sub { color: ${color.textSecondary}; margin: 4px 0 0; }
  .doc-title { font-size: 16px; font-weight: 500; margin: 0; text-align: right; }
  .doc-meta { color: ${color.textSecondary}; margin: 4px 0 0; text-align: right; }
  .doc-logo { width: 64px; height: 64px; object-fit: contain; border-radius: 32px; border: 1px solid ${color.border}; }

  table { width: 100%; border-collapse: collapse; margin: 8px 0 20px; }
  th {
    text-align: left; color: ${color.textSecondary}; font-size: 12px;
    padding: 8px 6px; border-bottom: 1px solid ${color.borderStrong}; background: ${color.surfaceRaised};
  }
  td { padding: 8px 6px; border-bottom: 1px solid ${color.border}; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .empty { text-align: center; color: ${color.textMuted}; padding: 24px 6px; }

  .summary {
    border: 1px solid ${color.border}; border-radius: 12px; background: ${color.surfaceRaised};
    padding: 12px 16px; margin-top: 8px;
  }
  .summary p { display: flex; justify-content: space-between; gap: 16px; margin: 6px 0; color: ${color.textSecondary}; }
  .summary p strong { color: ${color.textPrimary}; white-space: nowrap; }
  .summary p.grand { border-top: 1px solid ${color.border}; padding-top: 8px; margin-top: 8px; color: ${color.textPrimary}; }

  .summary p.fig-in strong { color: ${color.moneyIn}; }
  .summary p.fig-out strong { color: ${color.moneyOut}; }
  .in { color: ${color.moneyIn}; }
  .out { color: ${color.moneyOut}; }
  .attention { color: ${color.attention}; }
  .muted { color: ${color.textMuted}; }

  .doc-foot { margin-top: 28px; color: ${color.textMuted}; font-size: 11px; text-align: center; }
`;

/** Everything user-typed goes through this before it touches the HTML. */
export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Sentence-case a stored status/direction word for print ("unpaid" → "Unpaid"). */
export const printWord = (v: unknown): string => {
  const s = String(v ?? '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
};
