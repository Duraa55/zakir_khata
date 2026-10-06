import React from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * Shared by Add and Edit Khata entry so the two forms can never drift apart.
 *
 * Meaning, as the whole app uses it: Lena ("give") is credit GIVEN — the customer now
 * owes more, money out, red. Dena ("take") is a payment TAKEN — money in, green.
 */
export const KhataTypeToggle = ({ value, onChange }: { value: 'lena' | 'dena'; onChange: (t: 'lena' | 'dena') => void }) => {
  const { t: translate } = useLanguageStore();
  return (
  <View style={formStyles.toggleRow}>
    {(['lena', 'dena'] as const).map(t => {
      const active = value === t;
      const tone = t === 'lena' ? color.moneyOut : color.moneyIn;
      return (
        <TouchableOpacity
          key={t}
          style={[formStyles.toggleBtn, active && { backgroundColor: tone, borderColor: tone }]}
          onPress={() => onChange(t)}
          accessibilityRole="radio"
          accessibilityState={{ selected: active }}
        >
          <Icon name={t === 'lena' ? 'arrow-up-right' : 'arrow-down-left'} size={iconSize.sm} tint={active ? color.textInverse : tone} />
          <Text style={[formStyles.toggleText, active && formStyles.toggleTextActive]}>
            {translate(t === 'lena' ? 'khataTypeLena' : 'khataTypeDena')}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
  );
};

/** Screen header with a real back button — these forms used to have none. */
export const FormHeader = ({ title, onBack }: { title: string; onBack: () => void }) => {
  const { t } = useLanguageStore();
  return (
  <View style={formStyles.header}>
    <TouchableOpacity onPress={onBack} style={formStyles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
      <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
    </TouchableOpacity>
    <Text style={formStyles.headerTitle} numberOfLines={1}>{title}</Text>
    <View style={formStyles.backBtn} />
  </View>
  );
};

export const formStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: space.lg, paddingVertical: space.xl },
  field: { marginBottom: space.lg },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border, borderRadius: radius.md,
    paddingHorizontal: space.lg, minHeight: touchTarget, paddingVertical: space.sm, ...typeScale.body, color: color.textPrimary,
    justifyContent: 'center',
  },
  notes: { minHeight: 80, textAlignVertical: 'top', paddingTop: space.md },
  dateText: { ...typeScale.body, color: color.textPrimary },
  toggleRow: { flexDirection: 'row', gap: space.sm },
  toggleBtn: {
    flex: 1, flexDirection: 'row', gap: space.xs, minHeight: touchTarget, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.borderStrong, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm,
  },
  toggleText: { ...typeScale.bodyMedium, color: color.textPrimary },
  toggleTextActive: { color: color.textInverse },
  dropdown: {
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong, borderRadius: radius.md,
    marginTop: space.xs, maxHeight: 200, overflow: 'hidden',
  },
  dropItem: { minHeight: touchTarget, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: hairline, borderBottomColor: color.border, justifyContent: 'center' },
  dropName: { ...typeScale.bodyMedium, color: color.textPrimary },
  dropSub: { ...typeScale.caption, color: color.textSecondary },
  dropCreate: { minHeight: touchTarget, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.surfaceRaised },
  dropCreateText: { ...typeScale.bodyMedium, color: color.accent, flexShrink: 1 },
  save: { minHeight: 52, marginTop: space.sm },
  loadingText: { ...typeScale.body, color: color.textSecondary },
});
