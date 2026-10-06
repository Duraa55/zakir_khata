import { useLanguageStore } from '../../store/useLanguageStore';
import type { TKey } from '../../i18n/en';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { Icon } from '../ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { format, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths } from 'date-fns';
import { DateRangeFilter } from '../../services/database/reports/types';

export type DateFilterPreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'currentMonth' | 'lastMonth' | 'currentYear' | 'all';

/**
 * The range a preset stands for, in local dates. Exported so a screen can START on the
 * same range the picker shows: the picker only reports a range when the user picks one,
 * so screens that began with {} showed all-time figures under a "Current month" label.
 */
export const presetRange = (preset: DateFilterPreset): DateRangeFilter => {
  const now = new Date();
  let filter: DateRangeFilter = {};

  switch (preset) {
    case 'today':
      filter = { startDate: format(now, 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
      break;
    case 'yesterday': {
      const yesterday = subDays(now, 1);
      filter = { startDate: format(yesterday, 'yyyy-MM-dd'), endDate: format(yesterday, 'yyyy-MM-dd') };
      break;
    }
    case 'last7days':
      filter = { startDate: format(subDays(now, 7), 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
      break;
    case 'last30days':
      filter = { startDate: format(subDays(now, 30), 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
      break;
    case 'currentMonth':
      filter = { startDate: format(startOfMonth(now), 'yyyy-MM-dd'), endDate: format(endOfMonth(now), 'yyyy-MM-dd') };
      break;
    case 'lastMonth': {
      const lastM = subMonths(now, 1);
      filter = { startDate: format(startOfMonth(lastM), 'yyyy-MM-dd'), endDate: format(endOfMonth(lastM), 'yyyy-MM-dd') };
      break;
    }
    case 'currentYear':
      filter = { startDate: format(startOfYear(now), 'yyyy-MM-dd'), endDate: format(endOfYear(now), 'yyyy-MM-dd') };
      break;
    case 'all':
      filter = {};
      break;
  }
  return filter;
};

interface Props {
  onFilterChange: (filter: DateRangeFilter, label: string) => void;
  initialPreset?: DateFilterPreset;
}

export const DateFilterPicker: React.FC<Props> = ({ onFilterChange, initialPreset = 'currentMonth' }) => {
  const { t } = useLanguageStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [activeLabel, setActiveLabel] = useState<TKey>(initialPreset === 'all' ? 'allTime' : initialPreset);

  const handleSelect = (preset: DateFilterPreset, label: TKey) => {
    setActiveLabel(label);
    setModalVisible(false);

    const filter = presetRange(preset);

    onFilterChange(filter, t(label));
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setModalVisible(true)}
        accessibilityRole="button"
      >
        <Icon name="calendar" size={iconSize.sm} tint={color.textSecondary} />
        <Text style={styles.triggerLabel}>{t('dateRange')}</Text>
        <Text style={styles.triggerValue} numberOfLines={1}>{t(activeLabel)}</Text>
        <Icon name="chevron-down" size={iconSize.sm} tint={color.accent} />
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('selectRange')}</Text>
            </View>
            <ScrollView>
              {[
                { id: 'today', label: 'today' as const },
                { id: 'yesterday', label: 'yesterday' as const },
                { id: 'last7days', label: 'last7days' as const },
                { id: 'last30days', label: 'last30days' as const },
                { id: 'currentMonth', label: 'currentMonth' as const },
                { id: 'lastMonth', label: 'lastMonth' as const },
                { id: 'currentYear', label: 'currentYear' as const },
                { id: 'all', label: 'allTime' as const },
              ].map((item) => {
                const active = activeLabel === item.label;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.option}
                    onPress={() => handleSelect(item.id as DateFilterPreset, item.label)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>
                      {t(item.label)}
                    </Text>
                    {active && <Icon name="check" size={iconSize.sm} tint={color.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg },
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: color.surfaceRaised, paddingHorizontal: space.md, minHeight: touchTarget,
    borderRadius: radius.md, borderWidth: hairline, borderColor: color.border,
  },
  triggerLabel: { ...typeScale.label, color: color.textSecondary },
  triggerValue: { ...typeScale.bodyMedium, color: color.accent, flex: 1, textAlign: 'right' },
  overlay: { flex: 1, backgroundColor: color.scrim, justifyContent: 'center', alignItems: 'center', padding: space.lg },
  sheet: {
    backgroundColor: color.surface, width: '100%', maxWidth: 420, borderRadius: radius.lg, overflow: 'hidden', maxHeight: '80%',
    borderWidth: hairline, borderColor: color.border,
  },
  sheetHeader: { padding: space.lg, borderBottomWidth: hairline, borderBottomColor: color.border },
  sheetTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, textAlign: 'center' },
  option: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    minHeight: 52, paddingHorizontal: space.lg, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  optionText: { ...typeScale.body, color: color.textPrimary, flex: 1 },
  optionTextActive: { ...typeScale.bodyMedium, color: color.accent },
});
