import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Package, Building2, Warehouse, Archive,
  BarChart3, ArrowLeftRight, ShoppingCart, Users, FileUp,
  ChevronLeft, ChevronRight, LogOut, Pill, Clock, UserCheck, ClipboardList, Trophy,
  Heart, CalendarClock, Brain, TrendingUp, ShieldAlert, Zap, Truck, Phone,
} from 'lucide-react';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

const navItems = [
  // ── Overview
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'], svc: 'dashboard' },
  { label: 'Store Dashboard', path: '/store-dashboard', icon: Building2, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'], svc: 'store_dashboard' },
  { label: 'Top Selling', path: '/top-selling', icon: TrendingUp, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'], svc: 'top_selling' },

  // ── Inventory
  { section: 'Inventory', roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'] },
  { label: 'Products', path: '/products', icon: Package, roles: ['ADMIN'], svc: 'products' },
  { label: 'Stores', path: '/stores', icon: Building2, roles: ['ADMIN'], svc: 'stores' },
  { label: 'HO Stock', path: '/ho-stock', icon: Warehouse, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'ho_stock' },
  { label: 'Store Stock', path: '/store-stock', icon: Archive, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'], svc: 'store_stock' },
  { label: 'Consolidated', path: '/consolidated', icon: BarChart3, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'consolidated' },
  { label: 'Aging Report', path: '/aging', icon: Clock, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'aging' },
  { label: 'Expiry Risk', path: '/intel/expiry', icon: ShieldAlert, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'expiry_risk' },

  // ── Operations
  { section: 'Operations', roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'] },
  { label: 'Transfers', path: '/transfers', icon: ArrowLeftRight, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'], svc: 'transfers' },
  { label: 'Store Request', path: '/store-request', icon: ShoppingCart, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'], svc: 'purchases' },
  { label: 'PO Manager', path: '/po-management', icon: FileUp, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'purchases' },
  { label: 'Recall / Return', path: '/recalls', icon: ArrowLeftRight, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'], svc: 'recalls' },

  // ── Data Uploads
  { section: 'Uploads', roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'] },
  { label: 'Sales Upload', path: '/crm/sales-upload', icon: FileUp, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'CRM_STAFF', 'STORE_MANAGER', 'STORE_STAFF'], svc: 'sales_upload' },
  { label: 'Purchase Upload', path: '/purchase-report', icon: ShoppingCart, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER'], svc: 'purchase_upload' },
  { label: 'Upload History', path: '/uploads', icon: Clock, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'uploads' },

  // ── CRM
  { section: 'CRM', roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'] },
  { label: 'Store CRM', path: '/crm/store-crm', icon: Heart, roles: ['STORE_STAFF', 'STORE_MANAGER', 'ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'store_crm' },
  { label: 'Customers', path: '/crm/customers', icon: Users, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'], svc: 'crm_customers' },
  { label: 'RC Customers', path: '/crm/rc-customers', icon: UserCheck, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'], svc: 'rc_customers' },
  { label: 'Refill Due', path: '/crm/refill-due', icon: CalendarClock, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'], svc: 'refill_due' },
  { label: 'Call Tasks', path: '/crm/call-tasks', icon: Phone, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'], svc: 'call_tasks' },
  { label: 'Repeat Purchases', path: '/crm/repeat-purchases', icon: Trophy, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'], svc: 'repeat_purchases' },

  // ── Reports
  { section: 'Reports', roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'] },
  { label: 'CRM Reports', path: '/crm/reports', icon: BarChart3, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'CRM_STAFF', 'STORE_MANAGER'], svc: 'crm_reports' },
  { label: 'Daily Report', path: '/crm/daily-report', icon: ClipboardList, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'], svc: 'daily_report' },
  { label: 'Purchase History', path: '/crm/history', icon: Clock, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR', 'STORE_STAFF', 'STORE_MANAGER', 'CRM_STAFF'], svc: 'crm_history' },

  // ── Intelligence
  { section: 'Intelligence', roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'] },
  { label: 'Intel Center', path: '/intel', icon: Brain, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'intelligence' },
  { label: 'Forecast', path: '/intel/forecast', icon: TrendingUp, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'forecast' },
  { label: 'Suppliers', path: '/intel/suppliers', icon: Truck, roles: ['ADMIN', 'HO_STAFF', 'DIRECTOR'], svc: 'suppliers' },

  // ── Admin
  { section: 'Admin', roles: ['ADMIN'] },
  { label: 'Users', path: '/users', icon: Users, roles: ['ADMIN'], svc: 'users' },
  { label: 'Audit Log', path: '/audit-log', icon: ClipboardList, roles: ['ADMIN'], svc: 'audit_log' },
];

export default function DashboardLayout({ children }) {
  const { user, logout, impersonating, switchBack } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const userServices = user?.allowed_services ? user.allowed_services.split(',') : null;
  const filteredNav = navItems.filter(item => {
    if (item.section) {
      // Show section header if user role is in its roles
      return item.roles.includes(user?.role);
    }
    if (!item.roles.includes(user?.role)) return false;
    if (userServices && item.svc && !userServices.includes(item.svc)) return false;
    return true;
  });

  // Remove section headers that have no visible items after them
  const cleanedNav = filteredNav.filter((item, idx) => {
    if (!item.section) return true;
    // Check if next non-section item exists before the next section
    for (let i = idx + 1; i < filteredNav.length; i++) {
      if (filteredNav[i].section) return false; // Another section with nothing between
      if (filteredNav[i].path) return true; // Found a nav item
    }
    return false;
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const currentPage = cleanedNav.find(n => n.path === location.pathname)?.label || 'Dashboard';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <aside
        data-testid="sidebar"
        className={`${collapsed ? 'w-16' : 'w-64'} flex-shrink-0 bg-[#0F172A] text-white transition-all duration-300 flex flex-col`}
      >
        <div className="flex h-16 items-center justify-between px-4">
          {!collapsed && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-sky-500 rounded-sm flex items-center justify-center">
                <Pill className="w-4 h-4 text-white" />
              </div>
              <span className="font-heading text-sm font-bold tracking-tight">Sahakar Pharma</span>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 bg-sky-500 rounded-sm flex items-center justify-center mx-auto">
              <Pill className="w-4 h-4 text-white" />
            </div>
          )}
        </div>

        <Separator className="bg-slate-700/50" />

        <ScrollArea className="flex-1 px-2 py-3">
          <nav className="space-y-0.5">
            {cleanedNav.map((item, idx) => {
              if (item.section) {
                return !collapsed ? (
                  <div key={`section-${item.section}`} className="pt-4 pb-1 px-3 first:pt-0">
                    <p className="text-[9px] font-body font-semibold uppercase tracking-[0.15em] text-slate-500">{item.section}</p>
                  </div>
                ) : <div key={`section-${item.section}`} className="pt-3 pb-1"><Separator className="bg-slate-700/30" /></div>;
              }
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  data-testid={`nav-${item.path.slice(1)}`}
                  className={`flex items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] font-body transition-all duration-200 ${
                    isActive
                      ? 'bg-sky-500/15 text-sky-400 font-medium'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  <item.icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.75} />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>
        </ScrollArea>

        <Separator className="bg-slate-700/50" />

        <div className="p-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center justify-center gap-2 rounded-sm px-3 py-2 text-xs text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors"
            data-testid="sidebar-toggle"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span className="font-body">Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
          <h1 className="font-heading text-[15px] font-semibold text-slate-900 tracking-tight">{currentPage}</h1>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-[11px] font-body text-slate-400">
              <span>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span className="text-slate-200">|</span>
              <span className="uppercase tracking-wider">{user?.role?.replace('_', ' ')}</span>
            </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2.5 text-sm text-slate-600 hover:text-slate-900 transition-colors"
                data-testid="user-menu-trigger"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 text-xs font-bold font-heading">
                  {user?.full_name?.[0]?.toUpperCase() || 'U'}
                </div>
                <span className="font-body text-[13px] hidden sm:inline">{user?.full_name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-body text-xs">{user?.email}</DropdownMenuLabel>
              <DropdownMenuLabel className="font-body text-[10px] text-slate-400 uppercase tracking-wider -mt-1">
                {user?.role?.replace('_', ' ')}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="font-body text-xs" data-testid="logout-btn">
                <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        {impersonating && (
          <div className="flex items-center justify-between px-6 py-2 bg-amber-500 text-white">
            <span className="text-[12px] font-body font-medium">Viewing as: {user?.full_name} ({user?.role?.replace('_', ' ')}){user?.store_id ? ` | Store #${user.store_id}` : ''}</span>
            <button onClick={switchBack} className="text-[11px] font-body font-bold bg-white text-amber-700 px-3 py-1 rounded-sm hover:bg-amber-50 transition-colors" data-testid="switch-back-btn">Switch Back to Admin</button>
          </div>
        )}

        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
