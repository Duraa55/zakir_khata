import React, { useEffect, useState, useCallback } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { usePurchaseStore } from '../../store/usePurchaseStore';
import { useSupplierStore } from '../../store/useSupplierStore';
import { formatCurrency } from '../../utils/calculations';
import { PurchaseInvoiceItem } from '../../types/purchase.types';
import { Icon, AmountText, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

// Status carries meaning only: anything still owed is amber, settled is ink.
const STATUS_STYLE: Record<string, { tone: string; label: string }> = {
  unpaid:  { tone: color.attention, label: 'Unpaid' },
  partial: { tone: color.attention, label: 'Partial' },
  paid:    { tone: color.textPrimary, label: 'Paid' },
};

export const PurchaseInvoiceScreen = ({ navigation, route }: any) => {
  const insets = useSafeAreaInsets();
  const { invoiceId } = route.params;
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { selectedInvoice: invoice, loading, loadInvoiceById } = usePurchaseStore();

  const load = useCallback(() => loadInvoiceById(invoiceId), [invoiceId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  if (loading || !invoice) {
    return <View style={styles.center}><ActivityIndicator size="large" color={color.accent} /></View>;
  }

  const ss = STATUS_STYLE[invoice.status] ?? STATUS_STYLE.unpaid;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>#{invoice.invoice_number}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{invoice.supplier_name}</Text>
        </View>
        <View style={[styles.statusBadge, { borderColor: ss.tone }]}>
          <Text style={[styles.statusText, { color: ss.tone }]}>{ss.label}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>{t('piInvoiceDate')}</Text>
              <Text style={styles.summaryVal}>{invoice.invoice_date}</Text>
            </View>
            {invoice.due_date && (
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>{t('piDueDate')}</Text>
                <Text style={[styles.summaryVal, styles.dueDate]}>{invoice.due_date}</Text>
              </View>
            )}
            {invoice.po_id && (
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>{t('piLinkedOrder')}</Text>
                <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('PurchaseOrderDetail', { orderId: invoice.po_id })}>
                  <Text style={styles.linkText}>{t('piViewOrder')}</Text>
                  <Icon name="chevron-right" size={iconSize.sm} tint={color.accent} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          {invoice.notes && (
            <View style={styles.notesRow}>
              <Icon name="file-text" size={iconSize.sm} tint={color.textSecondary} />
              <Text style={styles.notes}>{invoice.notes}</Text>
            </View>
          )}
        </View>

        {/* Line Items */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('piItems')}</Text>
          {(invoice.items ?? []).map((item: PurchaseInvoiceItem) => (
            <View key={item.id} style={styles.lineRow}>
              <View style={styles.lineInfo}>
                <Text style={styles.lineName}>{item.item_name}</Text>
                <Text style={styles.lineDetail}>{item.quantity} × {formatCurrency(item.unit_cost, invoice.currency)}</Text>
              </View>
              <AmountText currency={invoice.currency} paisa={item.line_total} />
            </View>
          ))}

          <View style={styles.divider} />
          <View style={styles.totalRow}><Text style={styles.totalLabel}>{t('piSubtotal')}</Text><AmountText currency={invoice.currency} paisa={invoice.subtotal} size="label" /></View>
          {invoice.discount_amount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t('piDiscount')}</Text>
              <Text style={styles.totalVal}>−{formatCurrency(invoice.discount_amount, invoice.currency)}</Text>
            </View>
          )}
          {invoice.tax_amount > 0 && <View style={styles.totalRow}><Text style={styles.totalLabel}>Tax</Text><AmountText currency={invoice.currency} paisa={invoice.tax_amount} size="label" /></View>}
          <View style={[styles.totalRow, styles.grandRow]}>
            <Text style={styles.grandLabel}>{t('billTotal')}</Text>
            <AmountText currency={invoice.currency} paisa={invoice.total} size="title" />
          </View>
          <View style={styles.totalRow}><Text style={styles.totalLabel}>{t('piAmountPaid')}</Text><AmountText currency={invoice.currency} paisa={invoice.amount_paid} size="label" /></View>
          {invoice.balance_due > 0 && (
            <View style={[styles.totalRow, styles.dueRow]}>
              <Text style={styles.grandLabel}>{t('billBalanceDue')}</Text>
              <AmountText currency={invoice.currency} paisa={invoice.balance_due} tone="out" />
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('poActions')}</Text>
          {invoice.status !== 'paid' && (
            <Button
              label={t('piRecordPayment')}
              icon="credit-card"
              variant="secondary"
              fullWidth
              style={styles.actionBtn}
              onPress={() => navigation.navigate('AddSupplierPayment', {
                supplierId: invoice.supplier_id,
                supplierName: invoice.supplier_name,
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoice_number,
                maxAmount: invoice.balance_due,
              })}
            />
          )}
          <Button
            label={t('piPurchaseReturn')}
            icon="corner-up-left"
            variant="secondary"
            fullWidth
            style={styles.actionBtn}
            onPress={() => navigation.navigate('PurchaseReturn', {
              invoiceId: invoice.id,
              supplierId: invoice.supplier_id,
              supplierName: invoice.supplier_name,
              items: invoice.items,
              currency: invoice.currency,
            })}
          />
        </View>
      </ScrollView>

      {/* Sticky Pay Button */}
      {invoice.status !== 'paid' && (
        <View style={[styles.stickyBar, { bottom: 0 }]}>
          <View style={styles.stickyInfo}>
            <Text style={styles.stickyLabel}>{t('billBalanceDue')}</Text>
            <AmountText currency={invoice.currency} paisa={invoice.balance_due} tone="out" size="title" fit />
          </View>
          <Button
            label={t('supPayNow')}
            icon="arrow-right"
            onPress={() => navigation.navigate('AddSupplierPayment', {
              supplierId: invoice.supplier_id,
              supplierName: invoice.supplier_name,
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoice_number,
              maxAmount: invoice.balance_due,
            })}
          />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm,
    backgroundColor: color.surface, paddingHorizontal: space.md, minHeight: 56, paddingVertical: space.sm,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary },
  headerSub: { ...typeScale.caption, color: color.textSecondary },
  statusBadge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: hairline },
  statusText: { ...typeScale.caption },
  scroll: { paddingBottom: 180 },
  summaryCard: { backgroundColor: color.surface, margin: space.lg, borderRadius: radius.lg, padding: space.lg, borderWidth: hairline, borderColor: color.border },
  summaryRow: { flexDirection: 'row', gap: space.lg },
  summaryCol: { flex: 1 },
  summaryLabel: { ...typeScale.caption, color: color.textSecondary, marginBottom: 2 },
  summaryVal: { ...typeScale.bodyMedium, color: color.textPrimary },
  dueDate: { color: color.attention },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: touchTarget },
  linkText: { ...typeScale.bodyMedium, color: color.accent },
  notesRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.md },
  notes: { ...typeScale.label, flex: 1, color: color.textSecondary },
  card: { backgroundColor: color.surface, marginHorizontal: space.lg, marginBottom: space.md, borderRadius: radius.lg, padding: space.lg, borderWidth: hairline, borderColor: color.border },
  cardTitle: { ...typeScale.bodyMedium, color: color.textPrimary, marginBottom: space.md },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: hairline, borderBottomColor: color.border },
  lineInfo: { flex: 1 },
  lineName: { ...typeScale.bodyMedium, color: color.textPrimary },
  lineDetail: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  divider: { height: hairline, backgroundColor: color.border, marginVertical: space.md },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  totalLabel: { ...typeScale.label, color: color.textSecondary, flex: 1 },
  totalVal: { ...typeScale.label, color: color.textPrimary, flexShrink: 0 },
  grandRow: { paddingTop: space.md, marginTop: space.xs, borderTopWidth: hairline, borderTopColor: color.border },
  grandLabel: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1 },
  dueRow: { marginTop: space.xs, paddingVertical: space.sm },
  actionBtn: { marginBottom: space.sm },
  stickyBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: color.surface, borderTopWidth: hairline, borderTopColor: color.border, padding: space.lg,
  },
  stickyInfo: { flex: 1 },
  stickyLabel: { ...typeScale.caption, color: color.textSecondary },
});
