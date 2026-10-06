import React from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from './primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * Shown at the top of any book screen opened from a staff member's Entries, in place
 * of the book switcher (which would jump to the viewer's OWN books). Says whose entries
 * these are and that nothing here can be changed.
 */
export const ReadOnlyBanner = ({ name, book, onBack }: { name: string; book: string; onBack: () => void }) => {
  const { t } = useLanguageStore();
  return (
  <View style={styles.bar}>
    <TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
      <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
    </TouchableOpacity>
    <View style={styles.text}>
      <Text style={styles.title} numberOfLines={1}>{name} · {book}</Text>
      <View style={styles.pill}>
        <Icon name="eye" size={12} tint={color.textSecondary} />
        <Text style={styles.pillText}>{t('robReadOnly')}</Text>
      </View>
    </View>
  </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, minHeight: 56,
    backgroundColor: color.surface, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  back: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  // flex: 1 so a long (or Urdu) name wraps before it pushes anything off screen.
  text: { flex: 1, paddingVertical: space.sm },
  title: { ...typeScale.heading, color: color.textPrimary },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', marginTop: 2,
    paddingHorizontal: space.sm, paddingVertical: 1, borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
  },
  pillText: { ...typeScale.caption, color: color.textSecondary },
});
