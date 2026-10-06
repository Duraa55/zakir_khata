import React from 'react';
import { View, StyleSheet } from 'react-native';
import { color } from '../theme/tokens';

interface AmbientBackgroundProps {
  children?: React.ReactNode;
  style?: any;
}

/**
 * The app's root surface. It used to paint a dark background with coloured glow
 * gradients; the light design has one flat page colour and no decorative gradient
 * (the only gradient is the home hero card), so this is now just that surface. The
 * name and props are kept so the boot screen and Login need no other change.
 */
export const AmbientBackground: React.FC<AmbientBackgroundProps> = ({ children, style }) => (
  <View style={[styles.container, style]}>{children}</View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
});
