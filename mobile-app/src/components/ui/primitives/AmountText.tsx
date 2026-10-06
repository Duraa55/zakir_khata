import React from 'react';
import { Text, StyleProp, TextStyle } from 'react-native';
import { color, type as typeScale } from '../../../theme/tokens';
import { formatCurrency } from '../../../utils/calculations';
import type { CurrencyCode } from '../../../utils/currency';

type Tone = 'neutral' | 'in' | 'out' | 'muted';

const TONE_COLOR: Record<Tone, string> = {
  neutral: color.textPrimary,
  in: color.moneyIn,
  out: color.moneyOut,
  muted: color.textMuted,
};

/**
 * Money on screen. Takes integer paisa and formats it once, through the shared
 * formatter — never hand-divides by 100.
 *
 * A figure must never clip: it does not shrink in a row (flexShrink: 0) and it
 * stays on one line, so a long "Rs. 1,25,400" pushes the label instead of losing
 * its own digits. Pair it with a label carrying flex: 1.
 */
export const AmountText = ({
  paisa,
  tone = 'neutral',
  size = 'body',
  signed = false,
  fit = false,
  currency,
  style,
}: {
  paisa: number;
  tone?: Tone;
  size?: 'hero' | 'title' | 'body' | 'label';
  /** Show a leading minus for negatives — the shared formatter drops the sign. */
  signed?: boolean;
  /**
   * For a figure in a fixed-width column that cannot push anything aside (e.g. an
   * equal-flex summary row). It shrinks to fit rather than overflowing, since
   * flexShrink: 0 alone would just let a long "Rs. 1,25,400" run past the edge.
   *
   * This only worked once `flexShrink` started following `fit`. With it pinned to 0
   * the Text kept its full content width inside its flex: 1 column, so there was no
   * bound for adjustsFontSizeToFit to shrink against and nothing clipped the overflow:
   * the Cash Book's hero drew straight over its divider and its neighbour's figure from
   * Rs. 17,000 up (10 glyphs at fontSize 20 is ~105dp in a ~100dp column). A `fit`
   * figure must be shrinkable, or `fit` is only a comment.
   *
   * SCOPE: this covers a figure placed DIRECTLY in a row. A figure inside an
   * AmountStack is bounded by that stack's own `maxWidth` instead — a column sizes its
   * children on the cross axis, where flexShrink does nothing — so do not reach for
   * flexShrink to fix a stacked total that overflows. See AmountStack's `stack` style.
   */
  fit?: boolean;
  /**
   * The currency the ROW is in, straight from its own column. Omitted means PKR, so
   * every figure written before multi-currency renders exactly as it always did.
   * A figure is never converted — it is shown in the currency it was entered in.
   */
  currency?: CurrencyCode | string | null;
  style?: StyleProp<TextStyle>;
}) => {
  const scale =
    size === 'hero' ? typeScale.hero
    : size === 'title' ? typeScale.title
    : size === 'label' ? typeScale.label
    : typeScale.bodyMedium;

  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit={fit}
      minimumFontScale={fit ? 0.7 : undefined}
      style={[scale, { color: TONE_COLOR[tone], flexShrink: fit ? 1 : 0 }, style]}
    >
      {signed && paisa < 0 ? '−' : ''}{formatCurrency(paisa, currency)}
    </Text>
  );
};
