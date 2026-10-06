import React, { useState, useEffect, useMemo } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { executeGlobalSearch, SearchResult } from '../../services/database/searchDb';
import { formatDisplayDate, toDateValue } from '../../utils/dates';
import { Icon, AmountText, IconName } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

type Props = StackScreenProps<any, any>;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Highlights the typed text. The query is escaped first: "(" or "+" used to crash the
// screen because it went straight into a RegExp.
const HighlightedText = ({ text, query, style }: { text: string; query: string; style: any }) => {
  const q = query.trim();
  if (!q || !text) return <Text style={style} numberOfLines={1}>{text}</Text>;
  const parts = String(text).split(new RegExp(`(${escapeRegExp(q)})`, 'gi'));
  return (
    <Text style={style} numberOfLines={1}>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase()
          ? <Text key={i} style={styles.hit}>{part}</Text>
          : <Text key={i}>{part}</Text>
      )}
    </Text>
  );
};

const SECTION: Record<string, { title: string; icon: IconName }> = {
  customer: { title: 'Customers', icon: 'users' },
  khata: { title: 'Khata entries', icon: 'book-open' },
  bill: { title: 'Bills', icon: 'file-text' },
  product: { title: 'Products', icon: 'package' },
  expense: { title: 'Expenses', icon: 'credit-card' },
  staff: { title: 'Staff', icon: 'user' },
};

export const GlobalSearchScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.trim().length >= 2 && user) {
        setLoading(true);
        try {
          setResults(await executeGlobalSearch(searchQuery, user.id));
        } catch (err) {
          if (__DEV__) console.error(err);
        } finally {
          setLoading(false);
        }
      } else {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, user]);

  const groupedResults = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    results.forEach(item => {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    });
    return groups;
  }, [results]);

  // Each result opens where it lives. A customer or a Khata entry opens that customer's
  // ledger (it used to pass an id the ledger does not read, or a route that does not exist).
  const handleResultPress = (item: SearchResult) => {
    switch (item.type) {
      case 'customer':
      case 'khata': {
        const params = { partyName: item.title, userId: user?.id };
        // The admin keeps the customer ledger inside the Khata tab's own stack.
        if ((navigation.getState()?.routeNames ?? []).includes('CustomerDetail')) navigation.navigate('CustomerDetail', params);
        else navigation.navigate('Khata', { screen: 'CustomerDetail', params });
        break;
      }
      case 'bill':
        navigation.navigate('BillBook');
        break;
      case 'product':
        navigation.navigate('StockBook');
        break;
      case 'expense':
        navigation.navigate('ExpensesTab');
        break;
      case 'staff':
        navigation.navigate('StaffDetailBook', { staffId: item.id });
        break;
    }
  };

  const hasQuery = searchQuery.trim().length >= 2;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <View style={styles.searchBox}>
          <Icon name="search" size={iconSize.sm} tint={color.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('gsPlaceholder')}
            placeholderTextColor={color.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel={t('histClearSearch')}>
              <Icon name="x" size={iconSize.sm} tint={color.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.accent} />
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {Object.keys(groupedResults).length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name={hasQuery ? 'search' : 'compass'} size={40} tint={color.textMuted} />
              <Text style={styles.emptyText}>
                {hasQuery ? 'No results found' : 'Search across your customers, Khata, bills, products, expenses and staff.'}
              </Text>
            </View>
          ) : (
            Object.entries(groupedResults).map(([type, items]) => {
              const sec = SECTION[type] || { title: 'Results', icon: 'file' as IconName };
              return (
                <View key={type} style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Icon name={sec.icon} size={iconSize.sm} tint={color.textSecondary} />
                    <Text style={styles.sectionTitle}>{sec.title}</Text>
                    <Text style={styles.sectionCount}>{items.length}</Text>
                  </View>
                  {items.map(item => {
                    const day = item.date ? toDateValue(item.date) : null;
                    return (
                      <TouchableOpacity key={`${item.type}-${item.id}`} onPress={() => handleResultPress(item)} style={styles.result} activeOpacity={0.7}>
                        <View style={styles.resultText}>
                          <HighlightedText text={item.title} query={searchQuery} style={styles.resultTitle} />
                          <HighlightedText text={item.subtitle} query={searchQuery} style={styles.resultSub} />
                        </View>
                        <View style={styles.resultRight}>
                          {item.amount !== undefined && item.amount !== null && (
                            <AmountText
                              paisa={item.amount}
                              size="label"
                              tone={item.type === 'expense' ? 'out' : item.type === 'khata' ? (item.metadata?.type === 'lena' ? 'out' : 'in') : 'neutral'}
                            />
                          )}
                          {!!day && <Text style={styles.resultDate}>{formatDisplayDate(day)}</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, paddingVertical: space.sm, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingLeft: space.md, minHeight: touchTarget,
  },
  searchInput: { ...typeScale.body, flex: 1, color: color.textPrimary, paddingVertical: space.sm },
  clearBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: space.lg, paddingBottom: space.xxxl },
  emptyState: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: space.xl, gap: space.md },
  emptyText: { ...typeScale.body, color: color.textSecondary, textAlign: 'center' },
  section: { marginBottom: space.xl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  sectionTitle: { ...typeScale.heading, color: color.textPrimary, flex: 1 },
  sectionCount: { ...typeScale.caption, color: color.textSecondary },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget + space.md,
    backgroundColor: color.surface, padding: space.md, borderRadius: radius.md, marginBottom: space.sm,
    borderWidth: hairline, borderColor: color.border,
  },
  resultText: { flex: 1 },
  resultTitle: { ...typeScale.bodyMedium, color: color.textPrimary },
  resultSub: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },
  resultRight: { alignItems: 'flex-end', flexShrink: 0, gap: 2 },
  resultDate: { ...typeScale.caption, color: color.textMuted },
  // The match: a raised tone plus the medium weight — not a colour (colour means money).
  hit: { backgroundColor: color.surfacePressed, fontWeight: typeScale.bodyMedium.fontWeight, color: color.textPrimary },
});
