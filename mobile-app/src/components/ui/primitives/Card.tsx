import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { color, radius, space, hairline } from '../../../theme/tokens';

/**
 * A raised block. Its depth is one step of tone plus a hairline — deliberately
 * no shadow or elevation, which is what makes a light UI look muddy.
 */
export const Card = ({
  children,
  padded = true,
  tone = 'raised',
  style,
}: {
  children: React.ReactNode;
  padded?: boolean;
  /** `outlined` sits on the page; `raised` lifts off it. */
  tone?: 'raised' | 'outlined';
  style?: StyleProp<ViewStyle>;
}) => (
  <View
    style={[
      styles.base,
      tone === 'raised' ? styles.raised : styles.outlined,
      padded && { padding: space.lg },
      style,
    ]}
  >
    {children}
  </View>
);

const styles = StyleSheet.create({
  base: { borderRadius: radius.lg, borderWidth: hairline },
  raised: { backgroundColor: color.surfaceRaised, borderColor: color.border },
  outlined: { backgroundColor: color.surface, borderColor: color.border },
});
