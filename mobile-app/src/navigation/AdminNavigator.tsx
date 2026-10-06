import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../store/useLanguageStore';
import { Text, Keyboard, Platform } from 'react-native';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { tabBarScreenOptions, tabBarIcon } from './tabBarTheme';

// Admin screens
import { AdminDashboard } from '../screens/admin/AdminDashboard';
import { ActivityLogScreen } from '../screens/admin/ActivityLog';
import { StaffBooksView } from '../screens/admin/StaffBooksView';
import { SettingsScreen } from '../screens/staff/SettingsScreen';
import { ChangePasswordScreen } from '../screens/staff/ChangePasswordScreen';

// Shared book screens
import { CashBookScreen } from '../screens/CashBook/CashBookScreen';
import { CashEntryModal } from '../screens/CashBook/CashEntryModal';
import { CashEntryDetailScreen } from '../screens/CashBook/CashEntryDetailScreen';
import { CashHistory } from '../screens/CashBook/CashHistory';
import { StockBookScreen } from '../screens/StockBook/StockBookScreen';
import { StockInReportScreen } from '../screens/StockBook/StockInReportScreen';
import { StockOutReportScreen } from '../screens/StockBook/StockOutReportScreen';
import { StockMovementItemScreen } from '../screens/StockBook/StockMovementItemScreen';
import { AddItemModal } from '../screens/StockBook/AddItemModal';
import { StockItemDetailScreen } from '../screens/StockBook/StockItemDetailScreen';
import { BillBookScreen } from '../screens/BillBook/BillBookScreen';
import { CreateNewBillModal } from '../screens/BillBook/CreateNewBillModal';
import { BillDetailScreen } from '../screens/BillBook/BillDetailScreen';
import { StaffBookScreen } from '../screens/StaffBook/StaffBookScreen';
import { AddStaffModal } from '../screens/StaffBook/AddStaffModal';
import { StaffDetail } from '../screens/StaffBook/StaffDetail';
import { StaffEntriesScreen } from '../screens/StaffBook/StaffEntriesScreen';
import { StaffAttendanceScreen } from '../screens/StaffBook/StaffAttendanceScreen';
import { ExpenseBookScreen } from '../screens/ExpenseBook/ExpenseBookScreen';
import { AddExpenseModal } from '../screens/ExpenseBook/AddExpenseModal';
import { ExpenseDetail } from '../screens/ExpenseBook/ExpenseDetail';
import { DownloadOptionsModal } from '../components/Download/DownloadOptionsModal';
import { ReportsDashboardScreen } from '../screens/reports/ReportsDashboardScreen';
import { SalesReportScreen } from '../screens/reports/SalesReportScreen';
import { ProfitLossReportScreen } from '../screens/reports/ProfitLossReportScreen';
import { ExpenseReportScreen } from '../screens/reports/ExpenseReportScreen';
import { CashFlowReportScreen } from '../screens/reports/CashFlowReportScreen';
import { InventoryReportScreen } from '../screens/reports/InventoryReportScreen';
import { PartyReportScreen } from '../screens/reports/PartyReportScreen';
import { StaffReportScreen } from '../screens/reports/StaffReportScreen';
import { RemindersCenterScreen } from '../screens/reminders/RemindersCenterScreen';
import { AddReminderScreen } from '../screens/reminders/AddReminderScreen';
import { GlobalSearchScreen } from '../screens/search/GlobalSearchScreen';
import { SyncCenterScreen } from '../screens/sync/SyncCenterScreen';
import { SuppliersScreen } from '../screens/StockBook/SuppliersScreen';
import { AddSupplierModal } from '../screens/StockBook/AddSupplierModal';
import { SupplierProfileScreen } from '../screens/StockBook/SupplierProfileScreen';
import { SupplierLedgerScreen } from '../screens/StockBook/SupplierLedgerScreen';
import { AddSupplierPaymentModal } from '../screens/StockBook/AddSupplierPaymentModal';
import { ReturnItemsModal } from '../screens/BillBook/ReturnItemsModal';
import { PurchaseBookScreen } from '../screens/PurchaseBook/PurchaseBookScreen';
import { CreatePurchaseOrderModal } from '../screens/PurchaseBook/CreatePurchaseOrderModal';
import { PurchaseOrderDetailScreen } from '../screens/PurchaseBook/PurchaseOrderDetailScreen';
import { ReceiveGoodsModal } from '../screens/PurchaseBook/ReceiveGoodsModal';
import { PurchaseInvoiceScreen } from '../screens/PurchaseBook/PurchaseInvoiceScreen';
import { CreatePurchaseInvoiceModal } from '../screens/PurchaseBook/CreatePurchaseInvoiceModal';
import { PurchaseReturnModal } from '../screens/PurchaseBook/PurchaseReturnModal';
import { CustomerBookScreen } from '../screens/CustomerBook/CustomerBookScreen';
import { StaffSalaryDetailScreen } from '../screens/StaffBook/StaffSalaryDetailScreen';

// Khata Book Screens
import { KhataScreen } from '../screens/staff/KhataScreen';
import { CustomerDetailScreen } from '../screens/staff/CustomerDetailScreen';
import { AddTransactionScreen } from '../screens/staff/AddTransactionScreen';
import { EditTransactionScreen } from '../screens/staff/EditTransactionScreen';
import { AddCustomerModal } from '../screens/staff/AddCustomerModal';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// ─── Admin Home Stack (Dashboard + Staff lookup + Books) ──────────────────────────────
const AdminHomeStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="AdminDashboard" component={AdminDashboard} />
    <Stack.Screen name="CashBook" component={CashBookScreen} />
    <Stack.Screen name="StockBook" component={StockBookScreen} />
    <Stack.Screen name="BillBook" component={BillBookScreen} />
    <Stack.Screen name="StaffBook" component={StaffBookScreen} />
    <Stack.Screen name="ExpensesTab" component={ExpenseBookScreen} />
    <Stack.Screen name="PurchaseBook" component={PurchaseBookScreen} />
    <Stack.Screen name="CustomerBook" component={CustomerBookScreen} />
    <Stack.Screen name="CashInModal" component={CashEntryModal} options={{ presentation: 'modal' }} initialParams={{ mode: 'in' }} />
    <Stack.Screen name="CashOutModal" component={CashEntryModal} options={{ presentation: 'modal' }} initialParams={{ mode: 'out' }} />
    <Stack.Screen name="EditCashEntryModal" component={CashEntryModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="CashEntryDetail" component={CashEntryDetailScreen} />
    <Stack.Screen name="CashHistory" component={CashHistory} />
    <Stack.Screen name="StockInReportScreen" component={StockInReportScreen} />
    <Stack.Screen name="StockOutReportScreen" component={StockOutReportScreen} />
    {/* One item's movements in one direction, opened from a stock report. */}
    <Stack.Screen name="StockMovementItem" component={StockMovementItemScreen} />
    <Stack.Screen name="AddItemModal" component={AddItemModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="SuppliersScreen" component={SuppliersScreen} />
    <Stack.Screen name="AddSupplierModal" component={AddSupplierModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="SupplierProfile" component={SupplierProfileScreen} />
    <Stack.Screen name="SupplierLedger" component={SupplierLedgerScreen} />
    <Stack.Screen name="AddSupplierPayment" component={AddSupplierPaymentModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="CreatePurchaseInvoice" component={CreatePurchaseInvoiceModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="StockItemDetail" component={StockItemDetailScreen} />
    <Stack.Screen name="CreatePurchaseOrder" component={CreatePurchaseOrderModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="PurchaseOrderDetail" component={PurchaseOrderDetailScreen} />
    <Stack.Screen name="ReceiveGoods" component={ReceiveGoodsModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="PurchaseInvoiceDetail" component={PurchaseInvoiceScreen} />
    <Stack.Screen name="PurchaseReturn" component={PurchaseReturnModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="CreateNewBillModal" component={CreateNewBillModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="BillDetailScreen" component={BillDetailScreen} />
    <Stack.Screen name="ReturnItemsModal" component={ReturnItemsModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="AddStaffModal" component={AddStaffModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="StaffDetailBook" component={StaffDetail} />
    <Stack.Screen name="StaffEntries" component={StaffEntriesScreen} />
    {/* Staff Book → Entries → Khata opens a staff member's khata READ-ONLY from this stack
        (the Khata tab keeps its own stack for the viewer's own khata). */}
    <Stack.Screen name="StaffKhata" component={KhataScreen} />
    <Stack.Screen name="CustomerDetail" component={CustomerDetailScreen} />
    <Stack.Screen name="StaffSalaryDetail" component={StaffSalaryDetailScreen} />
    <Stack.Screen name="StaffAttendance" component={StaffAttendanceScreen} />
    <Stack.Screen name="AddExpenseModal" component={AddExpenseModal} options={{ presentation: 'modal' }} />
    <Stack.Screen name="ExpenseDetail" component={ExpenseDetail} />
    <Stack.Screen name="ActivityLog" component={ActivityLogScreen} />
    <Stack.Screen name="StaffBooksView" component={StaffBooksView} />
    <Stack.Screen name="ReportsDashboard" component={ReportsDashboardScreen} />
    <Stack.Screen name="SalesReport" component={SalesReportScreen} />
    <Stack.Screen name="ProfitLossReport" component={ProfitLossReportScreen} />
    <Stack.Screen name="ExpenseReport" component={ExpenseReportScreen} />
    <Stack.Screen name="CashFlowReport" component={CashFlowReportScreen} />
    <Stack.Screen name="InventoryReport" component={InventoryReportScreen} />
    <Stack.Screen name="PartyReport" component={PartyReportScreen} />
    <Stack.Screen name="StaffReport" component={StaffReportScreen} />
    <Stack.Screen name="RemindersCenter" component={RemindersCenterScreen} />
    <Stack.Screen name="AddReminder" component={AddReminderScreen} />
    <Stack.Screen name="GlobalSearch" component={GlobalSearchScreen} options={{ presentation: 'transparentModal' }} />
    <Stack.Screen name="SyncCenter" component={SyncCenterScreen} />
    <Stack.Screen name="DownloadOptionsModal" component={DownloadOptionsModal} options={{ presentation: 'transparentModal' }} />
  </Stack.Navigator>
);

// ─── Admin's own Khata Book ───────────────────────────────────────────────────
const AdminKhataStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="KhataMain" component={KhataScreen} />
    <Stack.Screen name="CustomerDetail" component={CustomerDetailScreen} />
    <Stack.Screen name="AddTransaction" component={AddTransactionScreen} />
    <Stack.Screen name="EditTransaction" component={EditTransactionScreen} />
    <Stack.Screen name="AddCustomerModal" component={AddCustomerModal} options={{ presentation: 'modal' }} />
  </Stack.Navigator>
);

// ─── Reports Stack ───────────────────────────────────────────────────────────
// The Reports tab's own stack: the hub plus the seven reports its tiles open. The
// same routes also stay registered in AdminHomeStack, untouched.
const ReportsStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="ReportsDashboard" component={ReportsDashboardScreen} />
    <Stack.Screen name="SalesReport" component={SalesReportScreen} />
    <Stack.Screen name="ProfitLossReport" component={ProfitLossReportScreen} />
    <Stack.Screen name="ExpenseReport" component={ExpenseReportScreen} />
    <Stack.Screen name="CashFlowReport" component={CashFlowReportScreen} />
    <Stack.Screen name="InventoryReport" component={InventoryReportScreen} />
    <Stack.Screen name="PartyReport" component={PartyReportScreen} />
    <Stack.Screen name="StaffReport" component={StaffReportScreen} />
  </Stack.Navigator>
);

// ─── Settings Stack ──────────────────────────────────────────────────────────
const SettingsStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="SettingsMain" component={SettingsScreen} />
    <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
  </Stack.Navigator>
);

const CustomHideableTabBar = (props: any) => {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (isKeyboardVisible) {
    return null;
  }

  return <BottomTabBar {...props} />;
};

// ─── Root Admin Tab Navigator ─────────────────────────────────────────────────
export const AdminNavigator = () => {
  const { t } = useLanguageStore();
  return (
  <Tab.Navigator
    tabBar={props => <CustomHideableTabBar {...props} />}
    screenOptions={tabBarScreenOptions}
  >
    <Tab.Screen
      name="Home"
      component={AdminHomeStack}
      options={{
        tabBarLabel: t('tabDashboard'),
        tabBarIcon: tabBarIcon('home'),
      }}
    />

    <Tab.Screen
      name="Khata"
      component={AdminKhataStack}
      options={{
        tabBarLabel: t('tabKhata'),
        tabBarIcon: tabBarIcon('book-open'),
      }}
    />

    <Tab.Screen
      name="Reports"
      component={ReportsStack}
      options={{
        tabBarLabel: t('tabReports'),
        tabBarIcon: tabBarIcon('bar-chart-2'),
      }}
    />

    <Tab.Screen
      name="More"
      component={SettingsStack}
      options={{
        tabBarLabel: t('tabSettings'),
        tabBarIcon: tabBarIcon('settings'),
      }}
    />
  </Tab.Navigator>
  );
};
