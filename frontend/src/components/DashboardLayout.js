import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Package, Building2, Warehouse, Archive,
  BarChart3, ArrowLeftRight, ShoppingCart, Users, FileUp,
  ChevronLeft, ChevronRight, LogOut, Pill, Clock, UserCheck, ClipboardList, Trophy,
  Heart, CalendarClock, Brain, TrendingUp, ShieldAlert, Zap, Truck,
} from 'lucide-react';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF'] },
  { label: 'Store Dash', path: '/store-dashboard', icon: Building2, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF'] },
  { label: 'Intelligence', path: '/intel', icon: Brain, roles: ['ADMIN', 'HO_STAFF'] },
  { label: 'Forecast', path: '/intel/forecast', icon: TrendingUp, roles: ['ADMIN', 'HO_STAFF'] },
  { label: 'Expiry Risk', path: '/intel/expiry', icon: ShieldAlert, roles: ['ADMIN', 'HO_STAFF'] },
  { label: 'Suppliers', path: '/intel/suppliers', icon: Truck, roles: ['ADMIN', 'HO_STAFF'] },
  { label: 'Products', path: '/products', icon: Package, roles: ['ADMIN'] },
  { label: 'Stores', path: '/stores', icon: Building2, roles: ['ADMIN'] },
  { label: 'HO Stock', path: '/ho-stock', icon: Warehouse, roles: ['ADMIN', 'HO_STAFF'] },
  { label: 'Store Stock', path: '/store-stock', icon: Archive, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF'] },
  { label: 'Consolidated', path: '/consolidated', icon: BarChart3, roles: ['ADMIN', 'HO_STAFF'] },
  { label: 'Scorecard', path: '/scorecard', icon: Trophy, roles: ['ADMIN', 'HO_STAFF'] },
  { label: 'Aging Report', path: '/aging', icon: Clock, roles: ['ADMIN', 'HO_STAFF'] },
  { label: 'Transfers', path: '/transfers', icon: ArrowLeftRight, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF'] },
  { label: 'Purchases', path: '/purchases', icon: ShoppingCart, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF'] },
  { label: 'CRM', path: '/crm', icon: Heart, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF', 'CRM_STAFF'] },
  { label: 'Sales Upload', path: '/crm/sales-upload', icon: FileUp, roles: ['ADMIN', 'HO_STAFF', 'CRM_STAFF'] },
  { label: 'Refill Due', path: '/crm/refill-due', icon: CalendarClock, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF', 'CRM_STAFF'] },
  { label: 'CRM Reports', path: '/crm/reports', icon: BarChart3, roles: ['ADMIN', 'HO_STAFF', 'CRM_STAFF'] },
  { label: 'History', path: '/crm/history', icon: Clock, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF', 'CRM_STAFF'] },
  { label: 'Customers', path: '/crm/customers', icon: Users, roles: ['ADMIN', 'HO_STAFF', 'STORE_STAFF', 'CRM_STAFF'] },
  { label: 'Users', path: '/users', icon: Users, roles: ['ADMIN'] },
  { label: 'Audit Log', path: '/audit-log', icon: ClipboardList, roles: ['ADMIN'] },
  { label: 'Uploads', path: '/uploads', icon: FileUp, roles: ['ADMIN', 'HO_STAFF'] },
];

export default function DashboardLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const filteredNav = navItems.filter(item => item.roles.includes(user?.role));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const currentPage = filteredNav.find(n => n.path === location.pathname)?.label || 'Dashboard';

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
            {filteredNav.map(item => {
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
        </header>

        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
