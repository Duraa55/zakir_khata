import { useLanguageStore } from '../store/useLanguageStore';
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from './ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../theme/tokens';

interface TranslateToUrduProps {
  value?: string;
  onSave: (urduText: string) => void;
  placeholder?: string;
}

/** Add or edit the Urdu name next to an English one. The Urdu field is right-to-left. */
export function TranslateToUrdu({ value, onSave, placeholder }: TranslateToUrduProps) {
  const { t } = useLanguageStore();
  const [isEditing, setIsEditing] = useState(false);
  const [urduText, setUrduText] = useState(value || '');

  if (!isEditing && !value) {
    return (
      <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.link} accessibilityRole="button">
        <Icon name="plus" size={iconSize.sm} tint={color.accent} />
        <Text style={styles.linkText}>{t('translateUrdu')}</Text>
      </TouchableOpacity>
    );
  }

  if (!isEditing && value) {
    return (
      <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.link} accessibilityRole="button">
        <Icon name="check" size={iconSize.sm} tint={color.textSecondary} />
        <Text style={styles.savedText}>{value} {t('tapEdit')}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.editor}>
      <Text style={styles.label}>{t('urduName')}</Text>
      <TextInput
        value={urduText}
        onChangeText={setUrduText}
        placeholder={placeholder ?? t('namePlaceholder')}
        placeholderTextColor={color.textMuted}
        style={styles.input}
      />
      <View style={styles.buttons}>
        <TouchableOpacity onPress={() => { onSave(urduText); setIsEditing(false); }} style={[styles.btn, styles.btnPrimary]} accessibilityRole="button">
          <Text style={styles.btnPrimaryText}>{t('save')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setIsEditing(false)} style={[styles.btn, styles.btnSecondary]} accessibilityRole="button">
          <Text style={styles.btnSecondaryText}>{t('cancel')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touchTarget, alignSelf: 'flex-start' },
  linkText: { ...typeScale.label, color: color.accent },
  savedText: { ...typeScale.label, color: color.textSecondary },
  editor: { marginTop: space.sm },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.xs },
  input: {
    textAlign: 'right', writingDirection: 'rtl', ...typeScale.body, color: color.textPrimary,
    borderWidth: hairline, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.surfaceRaised,
    paddingHorizontal: space.md, minHeight: touchTarget,
  },
  buttons: { flexDirection: 'row', marginTop: space.sm, gap: space.sm },
  btn: { minHeight: touchTarget, paddingHorizontal: space.lg, borderRadius: radius.md, justifyContent: 'center' },
  btnPrimary: { backgroundColor: color.accent },
  btnPrimaryText: { ...typeScale.bodyMedium, color: color.textInverse },
  btnSecondary: { borderWidth: hairline, borderColor: color.borderStrong },
  btnSecondaryText: { ...typeScale.bodyMedium, color: color.textSecondary },
});
