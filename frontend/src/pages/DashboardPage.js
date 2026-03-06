import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Package, Building2, ArrowLeftRight, ShoppingCart, Warehouse, TrendingUp, FileUp } from 'lucide-react';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/stats')
      .then(res => setStats(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in" data-testid="dashboard-loading">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-sm" />)}
        </div>
      </div>
    );
  }

  const kpis = [
    { label: 'Total Products', value: (stats?.total_products || 0).toLocaleString(), icon: Package, bg: 'bg-sky-50', fg: 'text-sky-600' },
    { label: 'Active Stores', value: stats?.total_stores || 0, icon: Building2, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
    { label: 'Pending Transfers', value: stats?.pending_transfers || 0, icon: ArrowLeftRight, bg: 'bg-amber-50', fg: 'text-amber-600' },
    { label: 'Purchase Requests', value: stats?.pending_purchases || 0, icon: ShoppingCart, bg: 'bg-rose-50', fg: 'text-rose-600' },
    { label: 'HO Stock Value', value: `INR ${(stats?.ho_stock_value || 0).toLocaleString('en-IN')}`, icon: Warehouse, bg: 'bg-violet-50', fg: 'text-violet-600' },
    { label: 'HO Stock Units', value: (stats?.ho_stock_units || 0).toLocaleString(), icon: TrendingUp, bg: 'bg-blue-50', fg: 'text-blue-600' },
  ];

  return (
    <div data-testid="dashboard-page" className="space-y-6">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Dashboard</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">Network-wide inventory overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi, i) => (
          <Card key={kpi.label} className={`border-slate-200 shadow-sm hover:-translate-y-px transition-transform duration-200 rounded-sm animate-fade-in-delay-${i+1}`}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-body font-medium text-slate-400 uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-2xl font-heading font-bold text-slate-900 mt-1 tabular-nums">{kpi.value}</p>
                </div>
                <div className={`p-2.5 rounded-sm ${kpi.bg}`}>
                  <kpi.icon className={`w-5 h-5 ${kpi.fg}`} strokeWidth={1.75} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
              <FileUp className="w-4 h-4 text-slate-400" /> Recent Uploads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recent_uploads?.length > 0 ? (
              <div className="space-y-0">
                {stats.recent_uploads.map(u => (
                  <div key={u.id} className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-body font-medium text-slate-800 truncate">{u.file_name}</p>
                      <p className="text-[11px] font-body text-slate-400 mt-0.5">
                        {u.success_records}/{u.total_records} records
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] rounded-sm font-body ml-2 shrink-0">
                      {u.upload_type?.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                <FileUp className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400 font-body">No recent uploads</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-slate-400" /> Recent Transfers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recent_transfers?.length > 0 ? (
              <div className="space-y-0">
                {stats.recent_transfers.map(t => (
                  <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-body font-medium text-slate-800">{t.product_name}</p>
                      <p className="text-[11px] font-body text-slate-400 mt-0.5">
                        {t.source_store} &rarr; {t.requesting_store} &middot; {t.quantity} units
                      </p>
                    </div>
                    <Badge className={`text-[10px] rounded-sm ml-2 shrink-0 ${
                      t.status === 'approved' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50' :
                      t.status === 'rejected' ? 'bg-red-50 text-red-700 hover:bg-red-50' :
                      'bg-amber-50 text-amber-700 hover:bg-amber-50'
                    }`}>
                      {t.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                <ArrowLeftRight className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400 font-body">No recent transfers</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
