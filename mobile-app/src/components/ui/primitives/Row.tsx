import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { color, radius, space, touchTarget, type as typeScale, hairline, iconSize } from '../../../theme/tokens';
import { Icon, IconName } from './Icon';

/**
 * A tappable line: icon, title, one line of detail, chevron.
 *
 * The text block takes flex: 1 and the trailing slot does not shrink, so a long
 * Urdu title wraps or ellipsises inside its own space instead of squeezing the
 * figure beside it.
 */
export const Row = ({
  title,
  detail,
  icon,
  iconTint = color.textSecondary,
  trailing,
  onPress,
  attention = false,
  style,
}: {
  title: string;
  detail?: string;
  icon?: IconName;
  iconTint?: string;
  /** Usually an AmountText; rendered before the chevron. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Outlines the row in amber — something to act on. */
  attention?: boolean;
  style?: StyleProp<ViewStyle>;
}) => {
  const body = (
    <>
      {!!icon && (
        <View style={styles.iconSlot}>
          <Icon name={icon} size={iconSize.md} tint={attention ? color.attention : iconTint} />
        </View>
      )}

      <View style={styles.text}>
        <Text style={[typeScale.bodyMedium, { color: color.textPrimary }]}>{title}</Text>
        {!!detail && (
          <Text style={[typeScale.label, { color: color.textSecondary, marginTop: 2 }]}>{detail}</Text>
        )}
      </View>

      {trailing}
      {!!onPress && <Icon name="chevron-right" size={iconSize.md} tint={color.textMuted} />}
    </>
  );

  if (!onPress) {
    return <View style={[styles.base, attention && styles.attention, style]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        attention && styles.attention,
        pressed && { backgroundColor: color.surfacePressed },
        style,
      ]}
    >
      {body}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget + space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  attention: { borderColor: color.borderAttention },
  iconSlot: { width: iconSize.lg, alignItems: 'center' },
  text: { flex: 1, flexShrink: 1 },
});
