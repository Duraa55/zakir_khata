import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, space, type as typeScale } from '../../../theme/tokens';

/** A quiet label above a group. Sentence case — never a shouty all-caps eyebrow. */
export const SectionHeader = ({ title, action }: { title: string; action?: React.ReactNode }) => (
  <View style={styles.base}>
    <Text style={[typeScale.label, { color: color.textSecondary, flex: 1 }]}>{title}</Text>
    {action}
  </View>
);

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.sm,
  },
});
