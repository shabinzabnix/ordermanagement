import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import DashboardLayout from '@/components/DashboardLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import ProductMasterPage from '@/pages/ProductMasterPage';
import StoreMasterPage from '@/pages/StoreMasterPage';
import HOStockUploadPage from '@/pages/HOStockUploadPage';
import StoreStockUploadPage from '@/pages/StoreStockUploadPage';
import ConsolidatedStockPage from '@/pages/ConsolidatedStockPage';
import TransfersPage from '@/pages/TransfersPage';
import PurchaseRequestsPage from '@/pages/PurchaseRequestsPage';
import UserManagementPage from '@/pages/UserManagementPage';
import UploadHistoryPage from '@/pages/UploadHistoryPage';
import InventoryAgingPage from '@/pages/InventoryAgingPage';
import RCCustomerPage from '@/pages/RCCustomerPage';
import AuditLogPage from '@/pages/AuditLogPage';
import StoreScorecardPage from '@/pages/StoreScorecardPage';
import CRMDashboardPage from '@/pages/CRMDashboardPage';
import CustomerProfilePage from '@/pages/CustomerProfilePage';
import RefillDuePage from '@/pages/RefillDuePage';
import SalesUploadPage from '@/pages/SalesUploadPage';
import CRMReportsPage from '@/pages/CRMReportsPage';
import CRMLoginPage from '@/pages/CRMLoginPage';
import IntelligenceDashboardPage from '@/pages/IntelligenceDashboardPage';
import DemandForecastPage from '@/pages/DemandForecastPage';
import ExpiryRiskPage from '@/pages/ExpiryRiskPage';
import SupplierIntelPage from '@/pages/SupplierIntelPage';
import StoreDashboardPage from '@/pages/StoreDashboardPage';
import PurchaseHistoryPage from '@/pages/PurchaseHistoryPage';
import StoreCustomerListPage from '@/pages/StoreCustomerListPage';
import TopSellingPage from '@/pages/TopSellingPage';
import PurchaseUploadPage from '@/pages/PurchaseUploadPage';
import StoreRequestPage from '@/pages/StoreRequestPage';
import POManagementPage from '@/pages/POManagementPage';
import PurchaseReviewPage from '@/pages/PurchaseReviewPage';
import StoreCRMDashboardPage from '@/pages/StoreCRMDashboardPage';
import RepeatPurchasesPage from '@/pages/RepeatPurchasesPage';
import RCCustomerListPage from '@/pages/RCCustomerListPage';
import '@/App.css';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          <p className="text-sm font-body text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <DashboardLayout>{children}</DashboardLayout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/crm-login" element={user ? <Navigate to="/crm" replace /> : <CRMLoginPage />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/store-dashboard" element={<ProtectedRoute><StoreDashboardPage /></ProtectedRoute>} />
      <Route path="/top-selling" element={<ProtectedRoute><TopSellingPage /></ProtectedRoute>} />
      <Route path="/purchase-report" element={<ProtectedRoute><PurchaseUploadPage /></ProtectedRoute>} />
      <Route path="/store-request" element={<ProtectedRoute><StoreRequestPage /></ProtectedRoute>} />
      <Route path="/po-management" element={<ProtectedRoute><POManagementPage /></ProtectedRoute>} />
      <Route path="/purchase-review" element={<ProtectedRoute><PurchaseReviewPage /></ProtectedRoute>} />
      <Route path="/intel" element={<ProtectedRoute><IntelligenceDashboardPage /></ProtectedRoute>} />
      <Route path="/intel/forecast" element={<ProtectedRoute><DemandForecastPage /></ProtectedRoute>} />
      <Route path="/intel/expiry" element={<ProtectedRoute><ExpiryRiskPage /></ProtectedRoute>} />
      <Route path="/intel/suppliers" element={<ProtectedRoute><SupplierIntelPage /></ProtectedRoute>} />
      <Route path="/intel/redistribution" element={<ProtectedRoute><IntelligenceDashboardPage /></ProtectedRoute>} />
      <Route path="/products" element={<ProtectedRoute><ProductMasterPage /></ProtectedRoute>} />
      <Route path="/stores" element={<ProtectedRoute><StoreMasterPage /></ProtectedRoute>} />
      <Route path="/ho-stock" element={<ProtectedRoute><HOStockUploadPage /></ProtectedRoute>} />
      <Route path="/store-stock" element={<ProtectedRoute><StoreStockUploadPage /></ProtectedRoute>} />
      <Route path="/consolidated" element={<ProtectedRoute><ConsolidatedStockPage /></ProtectedRoute>} />
      <Route path="/scorecard" element={<ProtectedRoute><StoreScorecardPage /></ProtectedRoute>} />
      <Route path="/transfers" element={<ProtectedRoute><TransfersPage /></ProtectedRoute>} />
      <Route path="/purchases" element={<ProtectedRoute><PurchaseRequestsPage /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><UserManagementPage /></ProtectedRoute>} />
      <Route path="/uploads" element={<ProtectedRoute><UploadHistoryPage /></ProtectedRoute>} />
      <Route path="/aging" element={<ProtectedRoute><InventoryAgingPage /></ProtectedRoute>} />
      <Route path="/customers" element={<ProtectedRoute><CRMDashboardPage /></ProtectedRoute>} />
      <Route path="/crm" element={<ProtectedRoute><CRMDashboardPage /></ProtectedRoute>} />
      <Route path="/crm/customer/:id" element={<ProtectedRoute><CustomerProfilePage /></ProtectedRoute>} />
      <Route path="/crm/refill-due" element={<ProtectedRoute><RefillDuePage /></ProtectedRoute>} />
      <Route path="/crm/sales-upload" element={<ProtectedRoute><SalesUploadPage /></ProtectedRoute>} />
      <Route path="/crm/reports" element={<ProtectedRoute><CRMReportsPage /></ProtectedRoute>} />
      <Route path="/crm/history" element={<ProtectedRoute><PurchaseHistoryPage /></ProtectedRoute>} />
      <Route path="/crm/customers" element={<ProtectedRoute><StoreCustomerListPage /></ProtectedRoute>} />
      <Route path="/crm/store-crm" element={<ProtectedRoute><StoreCRMDashboardPage /></ProtectedRoute>} />
      <Route path="/crm/repeat-purchases" element={<ProtectedRoute><RepeatPurchasesPage /></ProtectedRoute>} />
      <Route path="/crm/rc-customers" element={<ProtectedRoute><RCCustomerListPage /></ProtectedRoute>} />
      <Route path="/audit-log" element={<ProtectedRoute><AuditLogPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
