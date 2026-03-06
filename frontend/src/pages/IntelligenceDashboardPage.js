import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import {
  Warehouse, AlertTriangle, Clock, Heart, CalendarClock,
  ArrowLeftRight, ShoppingCart, Zap, TrendingUp, ShieldAlert,
} from 'lucide-react';

export default function IntelligenceDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/intel/dashboard')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-4"><div className="grid grid-cols-3 gap-4">{[...Array(9)].map((_, i) => <Skeleton key={i} className="h-28 rounded-sm" />)}</div></div>;

  const inv = data?.inventory || {};
  const cust = data?.customer || {};
  const ops = data?.operations || {};

  const Section = ({ title, icon: Icon, color, children }) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-sm ${color}`}><Icon className="w-4 h-4" strokeWidth={1.75} /></div>
        <h3 className="text-sm font-heading font-semibold text-slate-700">{title}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{children}</div>
    </div>
  );

  const Widget = ({ label, value, sub, onClick, alert }) => (
    <Card className={`border-slate-200 shadow-sm rounded-sm hover:-translate-y-px transition-all duration-200 ${onClick ? 'cursor-pointer' : ''} ${alert ? 'border-l-4 border-l-red-400' : ''}`}
      onClick={onClick} data-testid={`widget-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <CardContent className="p-4">
        <p className="text-[10px] font-body font-medium text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{value}</p>
        {sub && <p className="text-[11px] font-body text-slate-500 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );

  return (
    <div data-testid="intelligence-dashboard" className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Intelligence Center</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Unified operational intelligence across the pharmacy network</p>
        </div>
        <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" data-testid="generate-tasks-btn"
          onClick={() => api.post('/intel/auto-tasks').then(r => { const d = r.data; import('sonner').then(m => m.toast.success(`${d.tasks_created} CRM tasks generated`)); }).catch(() => {})}>
          <Zap className="w-3.5 h-3.5 mr-1.5" /> Generate CRM Tasks
        </Button>
      </div>

      <Section title="Inventory Intelligence" icon={Warehouse} color="bg-sky-50 text-sky-600">
        <Widget label="Total Inventory Value" value={`INR ${inv.total_value?.toLocaleString('en-IN')}`} />
        <Widget label="Dead Stock Value" value={`INR ${inv.dead_stock_value?.toLocaleString('en-IN')}`}
          onClick={() => navigate('/aging')} alert={inv.dead_stock_value > 0} sub="Click to view aging report" />
        <Widget label="Expiring Stock Value" value={`INR ${inv.expiring_value?.toLocaleString('en-IN')}`}
          onClick={() => navigate('/intel/expiry')} alert={inv.expiring_value > 0}
          sub={`30d: ${inv.expiring_30d} | 60d: ${inv.expiring_60d} | 90d: ${inv.expiring_90d}`} />
      </Section>

      <Section title="Customer Intelligence" icon={Heart} color="bg-rose-50 text-rose-600">
        <Widget label="Total Customers" value={cust.total_customers} onClick={() => navigate('/crm')} />
        <Widget label="RC Customers" value={cust.rc_customers} sub="Recurring + Chronic" />
        <Widget label="Due Today / Overdue" value={`${cust.due_today} / ${cust.overdue}`}
          onClick={() => navigate('/crm/refill-due')} alert={cust.overdue > 0} sub="Click to view refill due" />
      </Section>

      <Section title="Operations Intelligence" icon={TrendingUp} color="bg-emerald-50 text-emerald-600">
        <Widget label="Pending Transfers" value={ops.pending_transfers} onClick={() => navigate('/transfers')} />
        <Widget label="Pending Purchases" value={ops.pending_purchases} onClick={() => navigate('/purchases')} />
        <Widget label="Redistribution Suggestions" value={ops.redistribution_suggestions}
          onClick={() => navigate('/intel/redistribution')} sub="Dead stock with demand elsewhere" />
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-sky-200 bg-sky-50/30 shadow-sm rounded-sm cursor-pointer hover:-translate-y-px transition-all"
          onClick={() => navigate('/intel/forecast')} data-testid="goto-forecast">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-sky-100 rounded-sm"><TrendingUp className="w-6 h-6 text-sky-600" /></div>
            <div>
              <p className="text-sm font-heading font-semibold text-slate-800">Demand Forecasting</p>
              <p className="text-xs font-body text-slate-500 mt-0.5">View reorder recommendations based on sales trends</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/30 shadow-sm rounded-sm cursor-pointer hover:-translate-y-px transition-all"
          onClick={() => navigate('/intel/expiry')} data-testid="goto-expiry">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-sm"><ShieldAlert className="w-6 h-6 text-amber-600" /></div>
            <div>
              <p className="text-sm font-heading font-semibold text-slate-800">Expiry Risk Monitor</p>
              <p className="text-xs font-body text-slate-500 mt-0.5">Track batches expiring within 30/60/90 days</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
