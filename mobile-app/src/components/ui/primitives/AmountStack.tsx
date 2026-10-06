import React from 'react';
import { View, StyleProp, ViewStyle, TextStyle, StyleSheet } from 'react-native';
import { AmountText } from './AmountText';
import { space } from '../../../theme/tokens';
import type { CurrencyTotal } from '../../../utils/currencyTotals';

/**
 * A total that may span currencies: ONE line per currency, never a summed figure.
 *
 * With a single currency this renders exactly one AmountText with the same props a
 * plain total always had, so a single-currency day is pixel-identical to before
 * multi-currency existed. Only a genuinely mixed range grows a second line.
 *
 * The order is decided in `totalsFrom` (account default first, then alphabetical) and
 * is NOT re-sorted here, so the same data always stacks the same way.
 */
export const AmountStack = ({
  totals,
  tone = 'neutral',
  size = 'body',
  signed = false,
  fit = false,
  style,
  textStyle,
}: {
  totals: CurrencyTotal[];
  tone?: 'neutral' | 'in' | 'out' | 'muted';
  size?: 'hero' | 'title' | 'body' | 'label';
  signed?: boolean;
  fit?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) => {
  // Right-aligned so a stack of figures lines up under one another rather than
  // ragging, and `alignItems` rather than textAlign so each line keeps its own width.
  return (
    <View style={[styles.stack, style]}>
      {totals.map(t => (
        <AmountText
          key={t.currency}
          paisa={t.amount}
          currency={t.currency}
          tone={tone}
          size={size}
          signed={signed}
          fit={fit}
          style={textStyle}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  // gap, not margin, so a single-currency stack adds no spacing at all.
  //
  // maxWidth BOUNDS the stack, which is what makes `fit` work for the figures inside it.
  // A column sizes its children on the CROSS axis, so `flexShrink` on the text does
  // nothing here and `alignItems: 'flex-end'` sized each line to its own content: the
  // stack grew as wide as its widest figure and overran its column, which the Purchase
  // Book's four-up tile row showed as a total drawn over its neighbour. '100%' rather
  // than alignSelf: 'stretch' on purpose — stretch would also left/right-pin the stack
  // inside a centred tile and move every figure that fits today. With a bound, a line
  // too wide is clamped, and adjustsFontSizeToFit finally has something to shrink against.
  stack: { alignItems: 'flex-end', gap: space.xs, maxWidth: '100%' },
});
