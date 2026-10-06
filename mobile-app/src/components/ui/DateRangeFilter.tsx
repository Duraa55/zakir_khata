import { useLanguageStore } from '../../store/useLanguageStore';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { DateField } from './DateField';
import { Icon } from './primitives';
import { color, space, radius, hairline, chrome, iconSize, type as typeScale } from '../../theme/tokens';
import { parseDateValue, formatDisplayDate } from '../../utils/dates';

export type DateRange = { startDate?: string; endDate?: string };

/** Plain-language label for the active range, so a headline total always says
 *  which period it describes. Shared by every book that filters by date. */
export const describeRange = ({ startDate, endDate }: DateRange): string => {
  const { t } = useLanguageStore.getState();
  if (!startDate && !endDate) return t('allDatesLabel');
  if (startDate && endDate) return `${formatDisplayDate(startDate)} – ${formatDisplayDate(endDate)}`;
  return startDate ? t('fromDate', { date: formatDisplayDate(startDate) }) : t('upToDate', { date: formatDisplayDate(endDate) });
};

/**
 * Controlled calendar bounds; the host supplies its existing input/pill styles.
 *
 * COLLAPSED BY DEFAULT: a control used once a session must not hold space all session.
 * One line states the active range; the fields open on tap, and close again on a pick.
 * Every screen inherits this — none of them hand-rolls its own filter chrome.
 */
export const DateRangeFilter = ({ value, onChange, fieldStyle, textStyle, alwaysOpen = false }: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  fieldStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** For a screen whose whole job is the range (a report filter sheet). */
  alwaysOpen?: boolean;
}) => {
  const { t } = useLanguageStore();
  const [open, setOpen] = useState(false);
  if (!alwaysOpen && !open) {
    return (
      <TouchableOpacity
        style={styles.collapsed}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={describeRange(value)}
      >
        <Icon name="calendar" size={iconSize.sm} tint={color.textSecondary} />
        <Text style={styles.collapsedText} numberOfLines={1}>{describeRange(value)}</Text>
        <Icon name="chevron-down" size={iconSize.sm} tint={color.textSecondary} />
      </TouchableOpacity>
    );
  }
  return (
  <View style={{ marginTop: space.sm }}>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Text style={textStyle}>{t('from')}</Text>
        <DateField value={value.startDate || ''} placeholder={t('anyDate')} style={fieldStyle} textStyle={textStyle}
          maximumDate={parseDateValue(value.endDate) || undefined}
          onChange={startDate => { if (!value.endDate || startDate <= value.endDate) onChange({ ...value, startDate }); }} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={textStyle}>{t('to')}</Text>
        <DateField value={value.endDate || ''} placeholder={t('anyDate')} style={fieldStyle} textStyle={textStyle}
          minimumDate={parseDateValue(value.startDate) || undefined}
          onChange={endDate => { if (!value.startDate || endDate >= value.startDate) onChange({ ...value, endDate }); }} />
      </View>
    </View>
    <View style={styles.actions}>
      {(value.startDate || value.endDate) && (
        <TouchableOpacity onPress={() => onChange({})} style={styles.action}>
          <Text style={textStyle}>{t('allDates')}</Text>
        </TouchableOpacity>
      )}
      {!alwaysOpen && (
        <TouchableOpacity onPress={() => setOpen(false)} style={styles.action} accessibilityRole="button">
          <Text style={textStyle}>{t('done')}</Text>
        </TouchableOpacity>
      )}
    </View>
  </View>
);
};

const styles = StyleSheet.create({
  // One compact line. The label carries the meaning; it wraps before anything clips.
  collapsed: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    minHeight: chrome.barMinHeight, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: hairline, borderColor: color.border,
    backgroundColor: color.surfaceRaised,
  },
  collapsedText: { ...typeScale.label, color: color.textPrimary, flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.lg },
  action: { minHeight: chrome.barMinHeight, justifyContent: 'center' },
});
