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
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/products" element={<ProtectedRoute><ProductMasterPage /></ProtectedRoute>} />
      <Route path="/stores" element={<ProtectedRoute><StoreMasterPage /></ProtectedRoute>} />
      <Route path="/ho-stock" element={<ProtectedRoute><HOStockUploadPage /></ProtectedRoute>} />
      <Route path="/store-stock" element={<ProtectedRoute><StoreStockUploadPage /></ProtectedRoute>} />
      <Route path="/consolidated" element={<ProtectedRoute><ConsolidatedStockPage /></ProtectedRoute>} />
      <Route path="/transfers" element={<ProtectedRoute><TransfersPage /></ProtectedRoute>} />
      <Route path="/purchases" element={<ProtectedRoute><PurchaseRequestsPage /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><UserManagementPage /></ProtectedRoute>} />
      <Route path="/uploads" element={<ProtectedRoute><UploadHistoryPage /></ProtectedRoute>} />
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
