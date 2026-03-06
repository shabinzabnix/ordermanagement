import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  Package, Building2, ArrowLeftRight, ShoppingCart, Warehouse,
  TrendingUp, FileUp, AlertTriangle, TrendingDown, Zap,
} from 'lucide-react';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [intel, setIntel] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/stats'),
      api.get('/intelligence/summary'),
    ])
      .then(([s, i]) => { setStats(s.data); setIntel(i.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6" data-testid="dashboard-loading">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24 rounded-sm" />)}
        </div>
      </div>
    );
  }

  const kpis = [
    { label: 'Total Products', value: (stats?.total_products || 0).toLocaleString(), icon: Package, bg: 'bg-sky-50', fg: 'text-sky-600' },
    { label: 'Active Stores', value: stats?.total_stores || 0, icon: Building2, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
    { label: 'HO Stock Value', value: `INR ${(stats?.ho_stock_value || 0).toLocaleString('en-IN')}`, icon: Warehouse, bg: 'bg-violet-50', fg: 'text-violet-600' },
    { label: 'HO Stock Units', value: (stats?.ho_stock_units || 0).toLocaleString(), icon: TrendingUp, bg: 'bg-blue-50', fg: 'text-blue-600' },
    { label: 'Pending Transfers', value: stats?.pending_transfers || 0, icon: ArrowLeftRight, bg: 'bg-amber-50', fg: 'text-amber-600' },
    { label: 'Purchase Requests', value: stats?.pending_purchases || 0, icon: ShoppingCart, bg: 'bg-rose-50', fg: 'text-rose-600' },
    { label: 'Dead Stock', value: `${intel?.dead_stock_count || 0} items`, icon: AlertTriangle, bg: 'bg-red-50', fg: 'text-red-600', sub: `INR ${(intel?.dead_stock_value || 0).toLocaleString('en-IN')}` },
    { label: 'Slow Moving', value: `${intel?.slow_moving_count || 0} items`, icon: TrendingDown, bg: 'bg-orange-50', fg: 'text-orange-600', sub: `INR ${(intel?.slow_moving_value || 0).toLocaleString('en-IN')}` },
  ];

  return (
    <div data-testid="dashboard-page" className="space-y-6">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Dashboard</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">Network-wide inventory intelligence</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi, i) => (
          <Card key={kpi.label} className={`border-slate-200 shadow-sm hover:-translate-y-px transition-transform duration-200 rounded-sm animate-fade-in-delay-${Math.min(i+1, 5)}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-body font-medium text-slate-400 uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{kpi.value}</p>
                  {kpi.sub && <p className="text-[11px] font-body text-slate-500 mt-0.5">{kpi.sub}</p>}
                </div>
                <div className={`p-2 rounded-sm ${kpi.bg}`}>
                  <kpi.icon className={`w-4 h-4 ${kpi.fg}`} strokeWidth={1.75} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transfer Recommendations */}
      {intel?.recommendations?.length > 0 && (
        <Card className="border-sky-200 bg-sky-50/30 shadow-sm rounded-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-sky-600" /> Transfer Recommendations ({intel.recommendations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-sky-100">
                    {['Product', 'From', 'To', 'Qty', 'Reason'].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-sky-400 font-body py-2">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {intel.recommendations.map((r, i) => (
                    <TableRow key={i} className="border-b border-sky-50">
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{r.product_name}</TableCell>
                      <TableCell className="text-[12px] text-slate-600">{r.from_store}</TableCell>
                      <TableCell className="text-[12px] text-slate-600">{r.to_store}</TableCell>
                      <TableCell className="text-[12px] tabular-nums">{r.quantity}</TableCell>
                      <TableCell className="text-[11px] text-slate-500 max-w-[250px] truncate">{r.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dead Stock Alerts */}
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Dead Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {intel?.dead_stock?.length > 0 ? (
              <div className="space-y-0 max-h-[240px] overflow-auto">
                {intel.dead_stock.slice(0, 10).map((d, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-body font-medium text-slate-800 truncate">{d.product_name}</p>
                      <p className="text-[11px] font-body text-slate-400">{d.store} | Batch: {d.batch} | {d.stock} units</p>
                    </div>
                    <Badge className="text-[10px] rounded-sm bg-red-50 text-red-700 hover:bg-red-50 ml-2 shrink-0">{d.days}d</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <AlertTriangle className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400 font-body">No dead stock detected</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Uploads + Transfers */}
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
              <FileUp className="w-4 h-4 text-slate-400" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0 max-h-[240px] overflow-auto">
              {stats?.recent_uploads?.map(u => (
                <div key={`u-${u.id}`} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-body font-medium text-slate-800 truncate">{u.file_name}</p>
                    <p className="text-[11px] font-body text-slate-400">{u.success_records}/{u.total_records} records</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px] rounded-sm ml-2 shrink-0">{u.upload_type?.replace('_', ' ')}</Badge>
                </div>
              ))}
              {stats?.recent_transfers?.map(t => (
                <div key={`t-${t.id}`} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-body font-medium text-slate-800">{t.product_name}</p>
                    <p className="text-[11px] font-body text-slate-400">{t.source_store} &rarr; {t.requesting_store}</p>
                  </div>
                  <Badge className={`text-[10px] rounded-sm ml-2 shrink-0 ${
                    t.status === 'approved' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50' :
                    t.status === 'rejected' ? 'bg-red-50 text-red-700 hover:bg-red-50' :
                    'bg-amber-50 text-amber-700 hover:bg-amber-50'
                  }`}>{t.status}</Badge>
                </div>
              ))}
              {(!stats?.recent_uploads?.length && !stats?.recent_transfers?.length) && (
                <div className="text-center py-8">
                  <FileUp className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-xs text-slate-400 font-body">No recent activity</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
