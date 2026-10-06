import { useLanguageStore } from '../../store/useLanguageStore';
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Platform, StyleSheet,
  StyleProp, ViewStyle, TextStyle,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { localDate, parseDateValue, formatDisplayDate } from '../../utils/dates';
import { Icon } from './primitives';
import { color, space, iconSize, touchTarget, type as typeScale } from '../../theme/tokens';

/**
 * Shared date field — replaces the hand-typed "YYYY-MM-DD" TextInputs.
 *
 * It deliberately has NO box styling of its own: the host screen passes the very
 * `styles.input` its other fields use, so the field keeps the same box, border,
 * height and position in the form. Only the contents change, to the calendar glyph
 * calendar icon plus the formatted date.
 *
 * value / onChange speak YYYY-MM-DD, so call sites keep their existing state and
 * defaults. An invalid date is unreachable — the picker only emits real dates.
 */
interface Props {
  value: string;
  onChange: (value: string) => void;
  /** The host screen's input style, so the field looks unchanged in place. */
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
}

export const DateField: React.FC<Props> = ({
  value, onChange, style, textStyle, placeholder,
  minimumDate, maximumDate, disabled,
}) => {
  const { t } = useLanguageStore();
  const [open, setOpen] = useState(false);
  // Legacy rows may hold a full ISO timestamp or something malformed; fall back to
  // today for the picker's starting position without touching the stored value.
  const prompt = placeholder ?? t('selectDate');
  const selected = parseDateValue(value) ?? new Date();

  const commit = (next: Date) => onChange(localDate(next));

  const onAndroidChange = (event: DateTimePickerEvent, next?: Date) => {
    setOpen(false);
    if (event.type === 'set' && next) commit(next);
  };

  return (
    <>
      <TouchableOpacity
        style={[style, styles.row]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={value ? t('dateAccessible', { date: formatDisplayDate(value) }) : prompt}
      >
        <Icon name="calendar" size={iconSize.sm} tint={color.accent} />
        <Text style={[styles.text, !value && styles.placeholder, textStyle]} numberOfLines={1}>
          {value ? formatDisplayDate(value) : prompt}
        </Text>
      </TouchableOpacity>

      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={selected}
          mode="date"
          display="default"
          onChange={onAndroidChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.modalBg}>
            <View style={styles.sheet}>
              <DateTimePicker
                value={selected}
                mode="date"
                display="spinner"
                onChange={(_event: DateTimePickerEvent, next?: Date) => { if (next) commit(next); }}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
              />
              <TouchableOpacity style={styles.doneBtn} onPress={() => setOpen(false)}>
                <Text style={styles.doneText}>{t('done')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  text: { ...typeScale.body, flex: 1, color: color.textPrimary },
  placeholder: { color: color.textMuted },
  modalBg: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: color.surface, paddingBottom: space.xxl },
  doneBtn: { minHeight: touchTarget, padding: space.lg, alignItems: 'center', justifyContent: 'center' },
  doneText: { ...typeScale.bodyMedium, color: color.accent },
});
