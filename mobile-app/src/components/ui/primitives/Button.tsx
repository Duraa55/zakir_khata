import React from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { color, radius, space, touchTarget, type as typeScale, hairline } from '../../../theme/tokens';
import { Icon, IconName } from './Icon';

/**
 * `onBrand*` are for use on the hero's cyan fill only — a normal primary button
 * would be cyan-on-cyan and vanish there.
 */
type Variant = 'primary' | 'secondary' | 'quiet' | 'onBrand' | 'onBrandQuiet';

/**
 * Labels are passed in sentence case and rendered as given — no textTransform,
 * because ALL CAPS both reads cheap and breaks Urdu, which has no letter case.
 */
export const Button = ({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}) => {
  const tint =
    variant === 'primary' || variant === 'onBrandQuiet' ? color.textInverse
    : variant === 'onBrand' ? color.brand
    : color.textPrimary;
  const darkFill = variant === 'primary';
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'quiet' && styles.quiet,
        variant === 'onBrand' && styles.onBrand,
        variant === 'onBrandQuiet' && styles.onBrandQuiet,
        pressed && (darkFill ? styles.primaryPressed : styles.surfacePressed),
        fullWidth && { alignSelf: 'stretch' },
        inactive && styles.inactive,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tint} size="small" />
      ) : (
        <>
          {!!icon && <Icon name={icon} size={18} tint={tint} />}
          <Text numberOfLines={1} style={[typeScale.bodyMedium, { color: tint }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  primary: { backgroundColor: color.accent },
  primaryPressed: { backgroundColor: color.accentPressed },
  secondary: {
    backgroundColor: color.surface,
    borderWidth: hairline,
    borderColor: color.borderStrong,
  },
  quiet: { backgroundColor: 'transparent' },
  onBrand: { backgroundColor: color.onBrand },
  onBrandQuiet: {
    backgroundColor: color.onBrandFill,
    borderWidth: hairline,
    borderColor: color.onBrandBorder,
  },
  surfacePressed: { backgroundColor: color.surfacePressed },
  inactive: { opacity: 0.4 },
});
