import React from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, AmountText, AmountStack, Card, IconName } from '../ui/primitives';
import type { CurrencyTotal } from '../../utils/currencyTotals';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import type { CurrencyCode } from '../../utils/currency';

/**
 * The shared frame and building blocks for every report screen, so they read as one
 * family: a plain header (back · title · export), a scroll body, headline figures with
 * a one-line meaning each, and bar lists instead of multi-colour charts. Colour carries
 * meaning only — in green, out red, attention amber; totals and balances are ink.
 */

export const ReportScreen = ({
  title, onBack, onExport, children, loading,
}: {
  title: string;
  onBack: () => void;
  onExport?: () => void;
  children: React.ReactNode;
  loading?: boolean;
}) => {
  const { t } = useLanguageStore();
  return (
  <SafeAreaView style={styles.safe} edges={['top']}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
        <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      {onExport ? (
        <TouchableOpacity onPress={onExport} style={[styles.headerBtn, styles.exportBtn]} accessibilityRole="button" accessibilityLabel={t('repExport')}>
          <Icon name="download" size={iconSize.sm} tint={color.accent} />
          <Text style={styles.exportText}>{t('repExport')}</Text>
        </TouchableOpacity>
      ) : <View style={styles.headerBtn} />}
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {children}
      {loading && <ActivityIndicator size="large" color={color.accent} style={styles.spinner} />}
    </ScrollView>
  </SafeAreaView>
  );
};

export const ReportIntro = ({ children }: { children: React.ReactNode }) => (
  <Text style={styles.intro}>{children}</Text>
);

/** A headline figure: what it is, one line on what it means, the amount (never clipped). */
export const FigureRow = ({
  label, hint, paisa, totals, count, note, tone = 'neutral', signed = true, big, currency,
}: {
  label: string;
  hint?: string;
  paisa?: number;
  /** A figure that may span currencies — one line each, never their sum. */
  totals?: CurrencyTotal[];
  count?: number | string;
  /** Shown in place of a figure when there is honestly no single number to give. */
  note?: string;
  tone?: 'neutral' | 'in' | 'out' | 'muted';
  signed?: boolean;
  big?: boolean;
  currency?: CurrencyCode;
}) => (
  <View style={styles.figureRow}>
    <View style={styles.figureText}>
      <Text style={styles.figureLabel}>{label}</Text>
      {!!hint && <Text style={styles.figureHint}>{hint}</Text>}
    </View>
    {totals !== undefined
      ? <AmountStack totals={totals} tone={tone} signed={signed} size={big ? 'title' : 'body'} />
      : paisa !== undefined
        ? <AmountText paisa={paisa} tone={tone} signed={signed} size={big ? 'title' : 'body'} currency={currency} />
        : note !== undefined
          ? <Text style={styles.figureNote}>{note}</Text>
          : <Text style={[styles.count, tone === 'out' && { color: color.moneyOut }, tone === 'in' && { color: color.moneyIn }]}>{count}</Text>}
  </View>
);

export const Divider = () => <View style={styles.divider} />;

/** A card of figure rows separated by hairlines. */
export const FigureCard = ({ children }: { children: React.ReactNode }) => {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <Card tone="outlined" style={styles.figures}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Divider />}
          {child}
        </React.Fragment>
      ))}
    </Card>
  );
};

export const ReportSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

/**
 * One row of a bar list: label (+ a detail line), the exact amount, and a thin bar that
 * only compares rows with each other. Replaces the multi-colour pie/bar charts.
 */
export const BarRow = ({
  label, detail, paisa, totals, value, max, tone = 'neutral', first, currency,
}: {
  label: string;
  detail?: string;
  paisa?: number;
  /**
   * A row whose figure may span currencies. A bar compares rows against one scale, and
   * two currencies have no common scale, so a stacked row shows its figures and NO bar
   * rather than a bar drawn against a number that means nothing.
   */
  totals?: CurrencyTotal[];
  value?: number;
  max: number;
  tone?: 'neutral' | 'in' | 'out';
  first?: boolean;
  /** The row's own currency. Omitted = PKR, so every pre-multi-currency caller is unchanged. */
  currency?: CurrencyCode;
}) => {
  const stacked = !!totals && totals.length > 1;
  const v = paisa ?? (totals && totals.length === 1 ? totals[0].amount : undefined) ?? value ?? 0;
  const pct = max > 0 ? Math.max(2, Math.min(100, (Math.abs(v) / max) * 100)) : 2;
  const fill = tone === 'in' ? color.moneyIn : tone === 'out' ? color.moneyOut : color.accent;
  return (
    <View style={[styles.barRow, !first && styles.barRowBorder]}>
      <View style={styles.barTop}>
        <View style={styles.figureText}>
          <Text style={styles.barLabel}>{label}</Text>
          {!!detail && <Text style={styles.figureHint}>{detail}</Text>}
        </View>
        {totals !== undefined
          ? <AmountStack totals={totals} tone={tone} signed />
          : paisa !== undefined
            ? <AmountText paisa={paisa} tone={tone} signed currency={currency} />
            : <Text style={styles.barValue}>{value}</Text>}
      </View>
      {!stacked && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: fill }]} />
        </View>
      )}
    </View>
  );
};

/**
 * The currency a block of rows is denominated in. Rendered ONLY when the report spans
 * more than one, so a single-currency account never grows a heading it does not need
 * and its screens look exactly as they did before multi-currency existed.
 */
export const CurrencyHeading = ({ code, show }: { code: string; show: boolean }) =>
  show ? <Text style={styles.currencyHeading}>{code}</Text> : null;

export const BarList = ({ children }: { children: React.ReactNode }) => (
  <Card tone="outlined" padded={false}>{children}</Card>
);

export const EmptyNote = ({ children }: { children: React.ReactNode }) => (
  <Card tone="outlined"><Text style={styles.empty}>{children}</Text></Card>
);

/** Two or three segment tabs (e.g. Customers / Khata). */
export const ReportTabs = <T extends string>({ value, options, onChange }: {
  value: T; options: { id: T; label: string }[]; onChange: (id: T) => void;
}) => (
  <View style={styles.tabs}>
    {options.map(o => {
      const active = o.id === value;
      return (
        <TouchableOpacity key={o.id} style={[styles.tab, active && styles.tabActive]} onPress={() => onChange(o.id)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
          <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{o.label}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

/** A small stat tile for counts that sit side by side (items, low stock…). */
export const StatTile = ({ label, value, icon, tone }: { label: string; value: React.ReactNode; icon?: IconName; tone?: 'attention' | 'out' }) => (
  <View style={styles.tile}>
    <View style={styles.tileTop}>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
      {icon && <Icon name={icon} size={iconSize.sm} tint={tone === 'attention' ? color.attention : tone === 'out' ? color.moneyOut : color.textSecondary} />}
    </View>
    {typeof value === 'string' || typeof value === 'number'
      ? <Text style={[styles.tileValue, tone === 'attention' && { color: color.attention }, tone === 'out' && { color: color.moneyOut }]}>{value}</Text>
      : value}
  </View>
);

export const TileRow = ({ children }: { children: React.ReactNode }) => <View style={styles.tileRow}>{children}</View>;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, backgroundColor: color.surface,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  headerBtn: { minWidth: touchTarget, height: touchTarget, justifyContent: 'center', alignItems: 'center' },
  exportBtn: { flexDirection: 'row', gap: space.xs, paddingHorizontal: space.xs },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  exportText: { ...typeScale.bodyMedium, color: color.accent },
  scroll: { flex: 1, backgroundColor: color.surface },
  content: { padding: space.lg, paddingBottom: space.xxxl },
  spinner: { marginTop: space.xxxl },
  intro: { ...typeScale.label, color: color.textSecondary, marginBottom: space.md },

  figures: { gap: space.md },
  // Label takes the slack (Urdu runs ~40% longer); the figure never shrinks.
  figureRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  figureText: { flex: 1 },
  figureLabel: { ...typeScale.bodyMedium, color: color.textPrimary },
  figureHint: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  count: { ...typeScale.title, color: color.textPrimary, flexShrink: 0 },
  divider: { height: hairline, backgroundColor: color.border },

  figureNote: { ...typeScale.caption, color: color.textSecondary, flexShrink: 1, textAlign: 'right', maxWidth: '55%' },
  currencyHeading: {
    ...typeScale.label, color: color.textSecondary,
    marginTop: space.sm, marginBottom: space.xs,
  },
  section: { marginTop: space.xxl },
  sectionTitle: { ...typeScale.heading, color: color.textPrimary, marginBottom: space.sm },

  barRow: { paddingVertical: space.md, paddingHorizontal: space.lg },
  barRowBorder: { borderTopWidth: hairline, borderTopColor: color.border },
  barTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  barLabel: { ...typeScale.body, color: color.textPrimary },
  barValue: { ...typeScale.bodyMedium, color: color.textPrimary, flexShrink: 0 },
  barTrack: { height: 6, borderRadius: radius.pill, backgroundColor: color.surfaceRaised, marginTop: space.sm, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.pill },

  empty: { ...typeScale.body, color: color.textMuted },

  tabs: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  tab: {
    flex: 1, minHeight: touchTarget, borderRadius: radius.pill, borderWidth: hairline, borderColor: color.borderStrong,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm,
  },
  tabActive: { backgroundColor: color.accent, borderColor: color.accent },
  tabText: { ...typeScale.label, color: color.textSecondary },
  tabTextActive: { color: color.textInverse, fontWeight: typeScale.bodyMedium.fontWeight },

  tileRow: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  tile: {
    flex: 1, backgroundColor: color.surfaceRaised, borderRadius: radius.md, padding: space.md, gap: space.xs,
    borderWidth: hairline, borderColor: color.border,
  },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  tileLabel: { ...typeScale.label, color: color.textSecondary, flex: 1 },
  tileValue: { ...typeScale.title, color: color.textPrimary },
});
