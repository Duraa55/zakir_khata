import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { color, space } from '../../../theme/tokens';
import { ScreenContainer } from '../ScreenContainer';

/**
 * A page. Paints the background and hands scrolling plus the bottom-tab-bar
 * clearance to the existing ScreenContainer rather than reimplementing it — that
 * clearance was written to fix buttons hiding behind the floating tab bar, and a
 * second copy of that maths is how the bug comes back.
 */
export const Screen = ({
  children,
  scrollable = true,
  hasTabBar = true,
  padded = true,
  style,
  contentContainerStyle,
}: {
  children: React.ReactNode;
  scrollable?: boolean;
  hasTabBar?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) => (
  <View style={[styles.page, style]}>
    <ScreenContainer
      scrollable={scrollable}
      hasTabBar={hasTabBar}
      contentContainerStyle={[padded && styles.padded, contentContainerStyle]}
    >
      {children}
    </ScreenContainer>
  </View>
);

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.surface },
  padded: { paddingHorizontal: space.lg, paddingTop: space.lg },
});
