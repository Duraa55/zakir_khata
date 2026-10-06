import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Transaction } from '../types';
import { formatDate } from '../utils/calculations';
import { getDisplayName } from '../utils/displayName';
import { Icon, AmountText } from './ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../theme/tokens';

interface TransactionItemProps {
  transaction: Transaction;
  onPress: () => void;
}

/**
 * One Khata entry. Lena is credit GIVEN (money out, red); Dena is a payment TAKEN
 * (money in, green). The word and the arrow say it too — never colour alone.
 */
export const TransactionItem: React.FC<TransactionItemProps> = ({ transaction, onPress }) => {
  const isLena = transaction.type === 'lena';



  return (
    <TouchableOpacity onPress={onPress} style={styles.container} activeOpacity={0.7}>
      <View style={styles.row}>
        <Icon
          name={isLena ? 'arrow-up-right' : 'arrow-down-left'}
          size={iconSize.md}
          tint={isLena ? color.moneyOut : color.moneyIn}
        />
        <View style={styles.leftCol}>
          <Text style={styles.title}>{getDisplayName(transaction)}</Text>
          <Text style={styles.date}>{formatDate(transaction.date)}</Text>
          {!!transaction.notes && (
            <Text style={styles.notes}>{transaction.notes}</Text>
          )}
        </View>
        <View style={styles.rightCol}>
          <AmountText paisa={transaction.amount_paisa} tone={isLena ? 'out' : 'in'} />
          <Text style={[styles.typeText, isLena ? styles.textOut : styles.textIn]}>
            {isLena ? 'Lena' : 'Dena'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: color.border,
    padding: space.lg,
    marginBottom: space.sm,
    minHeight: touchTarget + space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  leftCol: {
    flex: 1,
  },
  title: {
    ...typeScale.bodyMedium,
    fontSize: 16,
    color: color.textPrimary,
  },
  date: {
    ...typeScale.label,
    color: color.textSecondary,
    marginTop: space.xs,
  },
  notes: {
    ...typeScale.caption,
    color: color.textMuted,
    marginTop: space.xs,
  },
  rightCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  typeText: {
    ...typeScale.caption,
    marginTop: 2,
  },
  textIn: { color: color.moneyIn },
  textOut: { color: color.moneyOut },
});
