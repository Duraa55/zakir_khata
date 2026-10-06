import React, { useMemo } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform, Image, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useBillStore } from '../../store/useBillStore';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency } from '../../utils/calculations';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { PRINT_STYLE, esc } from '../../components/Download/printStyle';
import { formatDisplayDate } from '../../utils/dates';
import { Icon, AmountText } from '../../components/ui/primitives';
import { useAttachmentOpener } from '../../components/ui/AttachmentViewer';
import { smsCost } from '../../utils/sms';

export const BillDetailScreen = ({ route, navigation }: any) => {
  const insets = useSafeAreaInsets();
  // One shared opener: images preview in-app, other files go to the phone, a missing
  // file says so — the same behaviour in every book.
  const { openAttachment, attachmentViewer } = useAttachmentOpener();
  const { billId } = route.params;
  const { bills } = useBillStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const bill = useMemo(() => bills.find(b => b.id === billId), [bills, billId]);
  
  const [logoBase64, setLogoBase64] = React.useState<string | null>(null);

  React.useEffect(() => {
    const loadLogo = async () => {
      try {
        if (user?.pictureUrl) {
          const base64 = await FileSystem.readAsStringAsync(user.pictureUrl, { encoding: FileSystem.EncodingType.Base64 });
          setLogoBase64(`data:image/jpeg;base64,${base64}`);
        }
      } catch (e) {
        if (__DEV__) console.warn('Failed to load logo base64', e);
      }
    };
    loadLogo();
  }, [user?.pictureUrl]);

  if (!bill) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.surface, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ ...typeScale.heading, fontSize: 18, color: color.textPrimary }}>{t('billNotFound')}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: space.lg, minHeight: touchTarget, justifyContent: 'center' }}>
          <Text style={{ ...typeScale.bodyMedium, color: color.accent }}>{t('commonGoBack')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const handleDownload = async () => {
    try {
      const html = generateHTML();
      const { uri } = await Print.printToFileAsync({ html });

      if (Platform.OS === 'android') {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          try {
            const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
            const newUri = await FileSystem.StorageAccessFramework.createFileAsync(
              permissions.directoryUri, 
              `Bill_${bill.bill_no}.pdf`, 
              'application/pdf'
            );
            await FileSystem.writeAsStringAsync(newUri, base64, { encoding: FileSystem.EncodingType.Base64 });
            Alert.alert(t('commonSuccess'), t('billDownloaded'));
          } catch (err) {
            if (__DEV__) console.error('SAF error:', err);
            Alert.alert(
              t('commonCannotSaveHere'),
              t('commonFolderNotWritable'),
              [
                { text: t('commonCancel'), style: 'cancel' },
                { text: t('commonShareInstead'), onPress: () => Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' }) }
              ]
            );
          }
        }
      } else {
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
      }
    } catch (e) {
      if (__DEV__) console.error(e);
      Alert.alert(t('commonError'), t('billDownloadFailed'));
    }
  };

  /**
   * Plain-text SMS with NO recipient: the messaging app opens with the body filled in
   * and the user picks the contact themselves. That is deliberate — the app holds no
   * customer phone number, and many customers have SMS but no data, so this reaches
   * people WhatsApp cannot.
   *
   * Never sends in the background, never attaches anything: an SMS carries text only,
   * so the PDF stays on the Download and WhatsApp buttons beside this one.
   */
  const handleSendSms = async () => {
    const body = t('billSmsBody', {
      shop: user?.businessName || user?.name || '',
      no: String(bill.bill_no),
      // Each figure formatted ONCE, in the bill's own currency.
      total: formatCurrency(bill.total, bill.currency),
      paid: formatCurrency(bill.paid, bill.currency),
      due: formatCurrency(bill.due, bill.currency),
    });
    // The customer is charged per part, so say how many before anything opens.
    const { parts } = smsCost(body);
    Alert.alert(
      t('billSmsConfirmTitle'),
      parts === 1 ? t('billSmsConfirmOne') : t('billSmsConfirmMany', { parts: String(parts) }),
      [
        { text: t('commonCancel'), style: 'cancel' },
        {
          text: t('billSmsOpen'),
          onPress: () => {
            // No recipient before the '?': the user chooses it in their own app.
            // iOS separates the body with '&', Android with '?'.
            const sep = Platform.OS === 'ios' ? '&' : '?';
            Linking.openURL(`sms:${sep}body=${encodeURIComponent(body)}`)
              .catch(() => Alert.alert(t('commonError'), t('billSmsFailed')));
          },
        },
      ],
    );
  };

  const handleShareWhatsApp = async () => {
    try {
      const html = generateHTML();
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) {
      if (__DEV__) console.error(e);
      Alert.alert(t('commonError'), t('billShareFailed'));
    }
  };

  // The same figures on screen and on paper, in bill order: items → subtotal → discount
  // → tax → total → received → balance due. (The due figure used to be printed under a
  // misleading label, and discount / tax never appeared, so a discounted bill did not add up.)
  const discount = bill.discount_amount || 0;
  const tax = bill.tax_amount || 0;

  const generateHTML = () => {
    const itemsHtml = (bill.items || []).map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${esc(item.item_name)}</td>
        <td class="num">${esc(item.quantity)}</td>
        <td class="num">${formatCurrency(item.unit_price, bill.currency)}</td>
        <td class="num">${formatCurrency(item.line_total, bill.currency)}</td>
      </tr>
    `).join('') || '<tr><td class="empty" colspan="5">No item lines — amount entered directly</td></tr>';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            ${PRINT_STYLE}
            .bill-to { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
            .label { color: ${color.textSecondary}; font-size: 12px; margin: 0 0 4px; }
            .value { font-size: 15px; font-weight: 500; margin: 0; }
            .right { text-align: right; }
            .totals { margin-left: auto; width: 60%; }
            .notes { margin-top: 24px; }
            .notes .box { border-top: 1px solid ${color.border}; border-bottom: 1px solid ${color.border}; padding: 12px 0; color: ${color.textSecondary}; min-height: 40px; }
          </style>
        </head>
        <body>
          <div class="doc-head">
            <div>
              <p class="doc-business">${esc(user?.businessName || 'Business name')}</p>
              ${user?.phone ? `<p class="doc-sub">${esc(user.phone)}</p>` : ''}
              ${user?.area ? `<p class="doc-sub">${esc(user.area)}</p>` : ''}
            </div>
            <div>
              ${logoBase64 ? `<img src="${logoBase64}" class="doc-logo" />` : ''}
              <p class="doc-title">Bill</p>
            </div>
          </div>

          <div class="bill-to">
            <div>
              <p class="label">Bill to</p>
              <p class="value">${esc(bill.party_name)}</p>
              ${bill.party_phone ? `<p class="doc-sub">${esc(bill.party_phone)}</p>` : ''}
            </div>
            <div class="right">
              <p class="label">Bill no. ${esc(bill.bill_no)}</p>
              <p class="value">${esc(formatDisplayDate(bill.bill_date))}</p>
            </div>
          </div>

          <table>
            <tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr>
            ${itemsHtml}
          </table>

          <div class="summary totals">
            <p>Subtotal: <strong>${formatCurrency(bill.subtotal, bill.currency)}</strong></p>
            ${discount > 0 ? `<p>Discount: <strong>−${formatCurrency(discount, bill.currency)}</strong></p>` : ''}
            ${tax > 0 ? `<p>Tax: <strong>${formatCurrency(tax, bill.currency)}</strong></p>` : ''}
            <p class="grand">Total: <strong>${formatCurrency(bill.total, bill.currency)}</strong></p>
            <p class="fig-in">Received: <strong>${formatCurrency(bill.paid, bill.currency)}</strong></p>
            <p class="grand ${bill.due > 0 ? 'fig-out' : ''}">Balance due: <strong>${formatCurrency(bill.due, bill.currency)}</strong></p>
          </div>

          ${bill.notes ? `<div class="notes"><p class="label">Details</p><div class="box">${esc(bill.notes)}</div></div>` : ''}
          <p class="doc-foot">Generated by AL-REEF</p>
        </body>
      </html>
    `;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('billDetailTitle', { no: bill.bill_no })}</Text>
        {/* Only the bill's author may edit it (enforced again in billDb). */}
        {bill.user_id === user?.id ? (
          <TouchableOpacity onPress={() => { navigation.goBack(); navigation.navigate('CreateNewBillModal', { billId: bill.id }); }} style={styles.editBtn}>
            <Text style={styles.editText}>{t('commonEdit')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.editBtn} />
        )}
      </View>

      <ScrollView style={{ flex: 1, backgroundColor: color.surfaceRaised }} contentContainerStyle={{ padding: space.lg }}>
        <View style={styles.invoiceCard}>
          {/* Header Info */}
          <View style={{ marginBottom: space.xxl, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.companyName}>{user?.businessName || t('billNoBusinessName')}</Text>
              <Text style={styles.companyContact}>{user?.phone || t('billNoPhone')}</Text>
              <Text style={styles.companyAddress}>{user?.area || t('billNoAddress')}</Text>
            </View>
            {logoBase64 && (
              <Image
                source={{ uri: logoBase64 }}
                style={{ width: 60, height: 60, borderRadius: 30, resizeMode: 'contain' }}
              />
            )}
          </View>

          <Text style={styles.invoiceTitle}>{t('billHeading')}</Text>

          <View style={styles.metaRow}>
            <View style={{ flex: 1, marginRight: space.md }}>
              <Text style={styles.metaLabel}>{t('billTo')}</Text>
              <Text style={styles.metaValue}>{bill.party_name}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
              <Text style={styles.metaLabel}>{t('billNoLabel', { no: bill.bill_no })}</Text>
              <Text style={styles.metaValue}>{formatDisplayDate(bill.bill_date)}</Text>
            </View>
          </View>

          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 0.5 }]}>#</Text>
            <Text style={[styles.th, { flex: 3 }]}>{t('commonName')}</Text>
            <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>{t('commonQty')}</Text>
            <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{t('commonPrice')}</Text>
            <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{t('commonAmount')}</Text>
          </View>

          {/* Table Body */}
          {bill.items?.map((item, index) => (
            <View key={item.id} style={styles.tableRow}>
              <Text style={[styles.td, { flex: 0.5 }]}>{index + 1}</Text>
              <Text style={[styles.td, { flex: 3 }]}>{item.item_name}</Text>
              <Text style={[styles.td, { flex: 1, textAlign: 'center' }]}>{item.quantity}</Text>
              <Text style={[styles.td, { flex: 1.5, textAlign: 'right' }]}>{formatCurrency(item.unit_price, bill.currency)}</Text>
              <Text style={[styles.td, { flex: 1.5, textAlign: 'right' }]}>{formatCurrency(item.line_total, bill.currency)}</Text>
            </View>
          ))}

          {/* Totals — the same order and labels as the printed bill. Received is money
              in (green); a balance still due is owed (red); the rest is neutral ink. */}
          <View style={styles.summaryContainer}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('billSubtotal')}</Text>
              <AmountText paisa={bill.subtotal} size="label" currency={bill.currency} />
            </View>
            {discount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{t('billDiscount')}</Text>
                <Text style={styles.summaryValue}>−{formatCurrency(discount, bill.currency)}</Text>
              </View>
            )}
            {tax > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{t('billTax')}</Text>
                <AmountText paisa={tax} size="label" currency={bill.currency} />
              </View>
            )}
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('billTotal')}</Text>
            <AmountText paisa={bill.total} currency={bill.currency} />
          </View>

          <View style={styles.summaryContainer}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('billReceived')}</Text>
              <AmountText paisa={bill.paid} tone="in" size="label" currency={bill.currency} />
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('billBalanceDue')}</Text>
              <AmountText paisa={bill.due} tone={bill.due > 0 ? 'out' : 'neutral'} size="label" currency={bill.currency} />
            </View>
          </View>

          {/* Details */}
          <View style={styles.detailsContainer}>
            <Text style={styles.detailsTitle}>{t('commonDetails')}</Text>
            <View style={styles.detailsBox}>
              <Text style={styles.detailsText}>{bill.notes || ' '}</Text>
            </View>
          </View>

          {/* Attachments — photos added while creating the bill */}
          {!!bill.attachment_urls?.length && (
            <View style={styles.detailsContainer}>
              <Text style={styles.detailsTitle}>{t('commonAttachments')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.xs }}>
                {bill.attachment_urls.map((uri, idx) => (
                  <TouchableOpacity key={idx} onPress={() => openAttachment(uri)} activeOpacity={0.85} accessibilityRole="imagebutton">
                    <Image source={{ uri }} style={styles.attachmentThumb} resizeMode="cover" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionGrid}>

          <TouchableOpacity style={styles.actionBtn} onPress={handleDownload}>
            <Icon name="download" size={iconSize.sm} tint={color.accent} />
            <Text style={styles.actionLabel}>{t('billDownload')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShareWhatsApp}>
            <Icon name="share-2" size={iconSize.sm} tint={color.accent} />
            <Text style={styles.actionLabel}>{t('commonShareWhatsApp')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleSendSms}>
            <Icon name="message-square" size={iconSize.sm} tint={color.accent} />
            <Text style={styles.actionLabel}>{t('billSendSms')}</Text>
          </TouchableOpacity>
        </View>
        {/* Returns: only the bill's author, and only when there are item lines to return. */}
        {bill.user_id === user?.id && !!bill.items?.length && (
          <TouchableOpacity style={[styles.actionBtn, styles.returnBtn]} onPress={() => navigation.navigate('ReturnItemsModal', { billId: bill.id })}>
            <Icon name="corner-up-left" size={iconSize.sm} tint={color.accent} />
            <Text style={styles.actionLabel}>{t('billReturnItems')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Footer — creating a bill lives on the Bill Book screen, not here. */}
      <View style={[styles.footer, { paddingBottom: 16 + Math.max(insets.bottom, 12) + 75 }]}>
        <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.doneText}>{t('commonDone')}</Text>
        </TouchableOpacity>
      </View>
      {attachmentViewer}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, height: 56, backgroundColor: color.surface,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1 },
  editBtn: { minWidth: touchTarget, height: touchTarget, alignItems: 'flex-end', justifyContent: 'center' },
  editText: { ...typeScale.bodyMedium, color: color.accent },

  // Flat: the bill sheet reads as paper through tone and a hairline, not a shadow.
  invoiceCard: {
    backgroundColor: color.surface,
    padding: space.xl,
    minHeight: 500,
    borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.border,
  },
  companyName: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary },
  companyContact: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  companyAddress: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },

  invoiceTitle: { fontSize: 24, textAlign: 'center', marginVertical: space.xl, fontFamily: 'serif', color: color.textPrimary },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xl },
  metaLabel: { fontSize: 12, color: color.textSecondary, marginBottom: space.xs },
  metaValue: { ...typeScale.bodyMedium, fontSize: 14, color: color.textPrimary },

  tableHeader: { flexDirection: 'row', borderBottomWidth: hairline, borderBottomColor: color.border, paddingBottom: space.sm, marginBottom: space.sm },
  th: { ...typeScale.caption, color: color.textMuted },

  tableRow: { flexDirection: 'row', marginBottom: space.sm },
  td: { fontSize: 12, color: color.textPrimary },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, borderTopWidth: hairline, borderBottomWidth: hairline, borderColor: color.border, paddingVertical: space.md, marginTop: space.md },
  totalLabel: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary, flex: 1 },

  summaryContainer: { alignItems: 'flex-end', marginTop: space.lg },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, width: '60%', marginBottom: space.sm },
  summaryLabel: { fontSize: 12, color: color.textSecondary, flex: 1 },
  summaryValue: { ...typeScale.label, color: color.textPrimary, flexShrink: 0 },

  detailsContainer: { marginTop: space.xxxl },
  detailsTitle: { fontSize: 14, color: color.textPrimary, marginBottom: space.sm },
  detailsBox: { borderTopWidth: hairline, borderBottomWidth: hairline, borderColor: color.border, paddingVertical: space.md },
  detailsText: { fontSize: 12, color: color.textSecondary, minHeight: 40 },
  attachmentThumb: { width: 90, height: 90, borderRadius: radius.sm, marginRight: space.sm, backgroundColor: color.surfaceRaised },

  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.xxl },
  actionBtn: {
    flexBasis: '47%', flexGrow: 1, flexDirection: 'row', gap: space.sm, minHeight: touchTarget, paddingHorizontal: space.sm, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.borderStrong, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { ...typeScale.label, fontWeight: typeScale.bodyMedium.fontWeight, color: color.accent, textAlign: 'center', flexShrink: 1 },
  returnBtn: { flex: 0, marginTop: space.md, marginBottom: space.xxl },

  footer: {
    flexDirection: 'row', backgroundColor: color.surface, padding: space.lg,
    borderTopWidth: hairline, borderTopColor: color.border, gap: space.md
  },
  doneBtn: {
    flex: 1, minHeight: 50, borderRadius: radius.md, backgroundColor: color.accent,
    justifyContent: 'center', alignItems: 'center',
  },
  doneText: { ...typeScale.bodyMedium, fontSize: 14, color: color.textInverse },
});
