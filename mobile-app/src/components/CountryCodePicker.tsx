import type { TKey } from '../i18n/en';
import { useLanguageStore } from '../store/useLanguageStore';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet, Platform } from 'react-native';
import { Icon } from './ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../theme/tokens';

export type CountryInfo = {
  name: string;
  labelKey: TKey;
  code: string;
  /** ISO short code shown instead of a flag emoji (emoji render differently on every phone). */
  iso: string;
};

export const ASIAN_COUNTRIES: CountryInfo[] = [
  { name: 'Pakistan', labelKey: 'country0', code: '+92', iso: 'PK' },
  { name: 'India', labelKey: 'country1', code: '+91', iso: 'IN' },
  { name: 'Bangladesh', labelKey: 'country2', code: '+880', iso: 'BD' },
  { name: 'Afghanistan', labelKey: 'country3', code: '+93', iso: 'AF' },
  { name: 'Saudi Arabia', labelKey: 'country4', code: '+966', iso: 'SA' },
  { name: 'United Arab Emirates', labelKey: 'country5', code: '+971', iso: 'AE' },
  { name: 'Qatar', labelKey: 'country6', code: '+974', iso: 'QA' },
  { name: 'Oman', labelKey: 'country7', code: '+968', iso: 'OM' },
  { name: 'Kuwait', labelKey: 'country8', code: '+965', iso: 'KW' },
  { name: 'Bahrain', labelKey: 'country9', code: '+973', iso: 'BH' },
  { name: 'Malaysia', labelKey: 'country10', code: '+60', iso: 'MY' },
  { name: 'Indonesia', labelKey: 'country11', code: '+62', iso: 'ID' },
  // Added 2026-10-03: USD and CNY are supported currencies, and the account default is
  // suggested from this code — without these two the suggestion could never reach them.
  { name: 'United States', labelKey: 'country12', code: '+1', iso: 'US' },
  { name: 'China', labelKey: 'country13', code: '+86', iso: 'CN' },
];

interface CountryCodePickerProps {
  selectedCode: string;
  onSelect: (code: string) => void;
}

export const CountryCodePicker = ({ selectedCode, onSelect }: CountryCodePickerProps) => {
  const { t } = useLanguageStore();
  const [modalVisible, setModalVisible] = useState(false);

  const selectedCountry = ASIAN_COUNTRIES.find(c => c.code === selectedCode) || ASIAN_COUNTRIES[0];

  return (
    <>
      <TouchableOpacity
        style={styles.container}
        onPress={() => setModalVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={t('selectCountry')}
      >
        <Text style={styles.iso}>{selectedCountry.iso}</Text>
        <Text style={styles.text}>{selectedCountry.code}</Text>
        <Icon name="chevron-down" size={iconSize.sm} tint={color.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('selectCountry')}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn} accessibilityRole="button">
                <Text style={styles.closeText}>{t('close')}</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={ASIAN_COUNTRIES}
              keyExtractor={item => item.code}
              renderItem={({ item }) => {
                const active = item.code === selectedCode;
                return (
                  <TouchableOpacity
                    style={styles.item}
                    onPress={() => {
                      onSelect(item.code);
                      setModalVisible(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={styles.itemIso}>{item.iso}</Text>
                    <Text style={styles.itemName}>{t(item.labelKey)}</Text>
                    <Text style={styles.itemCode}>{item.code}</Text>
                    {active && <Icon name="check" size={iconSize.sm} tint={color.accent} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 48, marginRight: space.sm,
  },
  iso: { ...typeScale.caption, color: color.textSecondary },
  text: { ...typeScale.bodyMedium, color: color.textPrimary },
  modalOverlay: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    maxHeight: '70%', paddingBottom: Platform.OS === 'ios' ? space.xxxl : space.xl,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    paddingLeft: space.xl, paddingRight: space.sm, minHeight: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  modalTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1 },
  closeBtn: { minHeight: touchTarget, paddingHorizontal: space.md, justifyContent: 'center' },
  closeText: { ...typeScale.bodyMedium, color: color.accent },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52,
    paddingHorizontal: space.xl, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  itemIso: { ...typeScale.caption, color: color.textSecondary, width: 28 },
  itemName: { ...typeScale.body, color: color.textPrimary, flex: 1 },
  itemCode: { ...typeScale.bodyMedium, color: color.textPrimary },
});
