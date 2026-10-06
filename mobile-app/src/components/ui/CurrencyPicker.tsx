import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useLanguageStore } from '../../store/useLanguageStore';
import { CURRENCIES, CURRENCY_CODES, resolveCurrency, type CurrencyCode } from '../../utils/currency';
import { color, space, radius, type as typeScale, hairline, touchTarget, iconSize } from '../../theme/tokens';
import { Icon } from './primitives';
import type { TKey } from '../../i18n/en';

/** Display name per currency. The CODE is stored; only this label is translated. */
const NAME_KEY: Record<CurrencyCode, TKey> = {
  PKR: 'currencyPKR',
  AED: 'currencyAED',
  USD: 'currencyUSD',
  CNY: 'currencyCNY',
};

/**
 * The currency control: a chip showing the current prefix with a chevron, which opens
 * the four supported currencies inline.
 *
 * Inline rather than a modal because it sits INSIDE a form that is often already a
 * modal, and a sheet over a sheet cannot be dismissed predictably on Android. It is
 * also not a native picker: React Native has no cross-platform one, and a platform
 * picker would ignore the design tokens entirely.
 *
 * `value` is whatever the row stored, so an unknown or missing code renders as PKR
 * rather than an empty chip — resolveCurrency is total.
 */
export const CurrencyPicker = ({ value, onChange, style, disabled }: {
  value?: CurrencyCode | string | null;
  onChange: (code: CurrencyCode) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) => {
  const t = useLanguageStore(s => s.t);
  const [open, setOpen] = useState(false);
  const current = resolveCurrency(value);

  return (
    <View style={style}>
      <Pressable
        onPress={() => setOpen(o => !o)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        accessibilityLabel={t('currencyLabel')}
        style={({ pressed }) => [
          styles.chip,
          open && styles.chipOpen,
          pressed && styles.chipPressed,
        ]}
      >
        {/* The prefix, not the code: it is what the figure beside it will carry. */}
        <Text style={styles.chipText}>{current.prefix.trim()}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={iconSize.sm} tint={color.accent} />
      </Pressable>

      {open && (
        <View style={styles.list}>
          {CURRENCY_CODES.map((code, i) => {
            const selected = code === current.code;
            return (
              <Pressable
                key={code}
                onPress={() => { onChange(code); setOpen(false); }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 && styles.rowDivider,
                  selected && styles.rowSelected,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text style={styles.rowCode}>{CURRENCIES[code].prefix.trim()}</Text>
                <Text style={styles.rowName} numberOfLines={1}>{t(NAME_KEY[code])}</Text>
                {selected && <Icon name="check" size={iconSize.md} tint={color.accent} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: touchTarget,
    paddingHorizontal: space.md,
    backgroundColor: color.surface,
    borderWidth: hairline,
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
  },
  chipOpen: { borderColor: color.accent },
  chipPressed: { backgroundColor: color.surfacePressed },
  chipText: { ...typeScale.bodyMedium, color: color.textPrimary },
  list: {
    marginTop: space.xs,
    borderWidth: hairline,
    borderColor: color.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touchTarget,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  rowDivider: { borderTopWidth: hairline, borderTopColor: color.border },
  rowSelected: { backgroundColor: color.surfaceRaised },
  rowPressed: { backgroundColor: color.surfacePressed },
  rowCode: { ...typeScale.bodyMedium, color: color.textPrimary, width: 46 },
  // flex so a longer Urdu currency name takes the room instead of truncating.
  rowName: { ...typeScale.body, color: color.textPrimary, flex: 1 },
});
