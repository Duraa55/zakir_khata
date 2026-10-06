import React from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Icon } from './primitives';
import { color, space, iconSize, touchTarget, type as typeScale } from '../../theme/tokens';

/**
 * THE "PDF report" button — one component for every book's sub-header (Cash, Bill,
 * Stock), so their text, icon, colour and size cannot drift apart again. Each screen
 * passes only what it exports.
 */
export const PdfReportButton = ({ onPress }: { onPress: () => void }) => {
  const { t } = useLanguageStore();
  return (
  <TouchableOpacity
    style={styles.btn}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={t('staffPdfReport')}
  >
    <Icon name="download" size={iconSize.sm} tint={color.brand} />
    <Text style={styles.text}>{t('staffPdfReport')}</Text>
  </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    minHeight: touchTarget, paddingHorizontal: space.sm, justifyContent: 'flex-end',
  },
  text: { ...typeScale.label, color: color.brand },
});
