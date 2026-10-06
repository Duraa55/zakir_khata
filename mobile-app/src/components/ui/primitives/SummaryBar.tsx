import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { brandGradient, color, space, radius, type as typeScale, chrome } from '../../../theme/tokens';

/**
 * The headline figure block at the top of a book, carrying the same brand surface as
 * the dashboard hero so the two read as one app.
 *
 * Everything inside sits on the brand fill, so text must use the `onBrand` tokens —
 * both gradient stops were picked to clear 4.5:1 for white (6.45:1 and 8.98:1).
 */
export const SummaryBar = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => (
  <LinearGradient
    colors={brandGradient}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={[styles.bar, style]}
  >
    {children}
  </LinearGradient>
);

/** A label above its figure. `children` is the figure — usually an AmountText. */
export const SummaryFigure = ({
  label,
  children,
  align = 'left',
}: {
  label: string;
  children: React.ReactNode;
  align?: 'left' | 'center';
}) => (
  <View style={[styles.figure, align === 'center' && { alignItems: 'center' }]}>
    {children}
    <Text style={[styles.label, align === 'center' && { textAlign: 'center' }]}>{label}</Text>
  </View>
);

/** Hairline between figures, in the on-brand tint rather than the page border. */
export const SummaryDivider = () => <View style={styles.divider} />;

export const summaryOnBrand = {
  text: color.onBrand,
  muted: color.onBrandMuted,
};

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: space.lg,
    marginTop: chrome.cardMarginY,
    marginBottom: chrome.cardMarginY,
    borderRadius: radius.md,
    // Chrome shrinks, the figure does not: only the padding gives way.
    paddingVertical: chrome.cardPadY,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // flex: 1 so a longer Urdu label takes the slack instead of squeezing the figure.
  figure: { flex: 1 },
  label: { ...typeScale.caption, color: color.onBrandMuted, marginTop: 2 },
  divider: { width: 1, height: 28, backgroundColor: color.onBrandBorder },
});
