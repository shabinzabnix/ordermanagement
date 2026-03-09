import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Building2, Warehouse, TrendingUp, Users, Package, Calendar, ShoppingBag, Truck } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function StoreDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [summary, setSummary] = useState([]);
  const isStore = ['STORE_STAFF', 'STORE_MANAGER'].includes(user?.role);
  const [selectedStore, setSelectedStore] = useState(isStore && user?.store_id ? String(user.store_id) : '');
  const [storeData, setStoreData] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/stores'),
      api.get('/intel/store-dashboard-summary'),
    ]).then(([s, sm]) => { setStores(s.data.stores); setSummary(sm.data.stores); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedStore) { setStoreData(null); return; }
    api.get(`/intel/store-dashboard/${selectedStore}`, { params: { date_from: dateFrom, date_to: dateTo } })
      .then(r => setStoreData(r.data)).catch(() => {});
  }, [selectedStore, dateFrom, dateTo]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (<div className="bg-white border border-slate-200 rounded-sm p-2.5 shadow-md">
      <p className="text-[11px] font-heading font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} className="text-[11px] font-body text-slate-500">{p.name}: <span className="font-medium text-slate-800">{typeof p.value === 'number' ? p.value.toLocaleString('en-IN') : p.value}</span></p>)}
    </div>);
  };

  if (loading) return <div className="space-y-4"><Skeleton className="h-16 rounded-sm" /><Skeleton className="h-96 rounded-sm" /></div>;

  return (
    <div data-testid="store-dashboard-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Store Dashboard</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Store-wise stock value & sales performance</p>
        </div>
      </div>

      {/* All Stores Summary */}
      {!selectedStore && summary.length > 0 && (
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold">All Stores - Stock & Sales (Last 30 days)</CardTitle></CardHeader>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-2 border-slate-100">
                  {['Store', 'Code', 'Stock Value', 'Stock Units', 'Sales (30d)', 'Invoices', 'Purchase (30d)'].map(h => (
                    <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Stock Value','Stock Units','Sales (30d)','Invoices','Purchase (30d)'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map(s => (
                  <TableRow key={s.store_id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => setSelectedStore(String(s.store_id))} data-testid={`store-summary-${s.store_id}`}>
                    <TableCell className="font-body text-[13px] font-medium text-sky-700">{s.store_name}</TableCell>
                    <TableCell className="font-mono text-[11px] text-slate-500">{s.store_code}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {s.stock_value.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums">{s.stock_units.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums font-medium text-emerald-700">INR {s.sales_value.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums">{s.sales_count}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums font-medium text-sky-700">INR {(s.purchase_value || 0).toLocaleString('en-IN')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Store Selector + Date Range */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3 flex-wrap items-end">
          <div className="space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">Store</label>
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger className="w-[220px] font-body text-sm rounded-sm" data-testid="store-dash-select"><SelectValue placeholder="Select store" /></SelectTrigger>
              <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name} ({s.store_code})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">From</label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[150px] font-body text-sm rounded-sm" data-testid="date-from" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">To</label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[150px] font-body text-sm rounded-sm" data-testid="date-to" />
          </div>
          {selectedStore && <Button variant="outline" size="sm" className="rounded-sm font-body text-xs" onClick={() => setSelectedStore('')}>All Stores</Button>}
        </CardContent>
      </Card>

      {/* Selected Store Detail */}
      {storeData && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              { l: 'Stock Value', v: `INR ${storeData.stock.value.toLocaleString('en-IN')}`, icon: Warehouse, bg: 'bg-sky-50', fg: 'text-sky-600' },
              { l: 'Stock Units', v: storeData.stock.units.toLocaleString(), icon: Package, bg: 'bg-blue-50', fg: 'text-blue-600' },
              { l: 'Sales Value', v: `INR ${storeData.sales.value.toLocaleString('en-IN')}`, icon: TrendingUp, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
              { l: 'Purchase Value', v: `INR ${(storeData.purchases?.value || 0).toLocaleString('en-IN')}`, icon: ShoppingBag, bg: 'bg-rose-50', fg: 'text-rose-600' },
              { l: 'Invoices', v: storeData.sales.count, icon: Calendar, bg: 'bg-amber-50', fg: 'text-amber-600' },
              { l: 'Customers', v: storeData.customer_count, icon: Users, bg: 'bg-violet-50', fg: 'text-violet-600' },
            ].map(k => (
              <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div><p className="text-[10px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p>
                      <p className="text-lg font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.v}</p></div>
                    <div className={`p-2 rounded-sm ${k.bg}`}><k.icon className={`w-4 h-4 ${k.fg}`} strokeWidth={1.75} /></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Daily Sales Chart */}
          {storeData.daily_sales?.length > 0 && (
            <Card className="border-slate-200 shadow-sm rounded-sm">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Date-wise Sales ({storeData.store.name})</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={storeData.daily_sales} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                    <YAxis tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="amount" fill="#10B981" radius={[3, 3, 0, 0]} name="Sales (INR)" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Daily Purchases Chart */}
          {storeData.daily_purchases?.length > 0 && (
            <Card className="border-slate-200 shadow-sm rounded-sm">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Date-wise Purchases ({storeData.store.name})</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={storeData.daily_purchases} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                    <YAxis tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="amount" fill="#0EA5E9" radius={[3, 3, 0, 0]} name="Purchase (INR)" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Top Products */}
          {storeData.top_products?.length > 0 && (
            <Card className="border-slate-200 shadow-sm rounded-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold">Top Selling Products</CardTitle></CardHeader>
              <div className="overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow className="border-b-2 border-slate-100">
                      {['#', 'Product', 'Qty Sold', 'Invoices', 'Revenue'].map(h => (
                        <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Qty Sold','Invoices','Revenue'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storeData.top_products.map((p, i) => (
                      <TableRow key={i} className="hover:bg-slate-50/50">
                        <TableCell className="text-[11px] text-slate-400 font-medium">{i + 1}</TableCell>
                        <TableCell className="font-body text-[13px] font-medium text-slate-800">{p.product}</TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums font-medium">{p.qty}</TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums text-slate-500">{p.count}</TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums font-medium text-emerald-700">INR {p.amount.toLocaleString('en-IN')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}

          {/* Top Suppliers */}
          {storeData.top_suppliers?.length > 0 && (
            <Card className="border-slate-200 shadow-sm rounded-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Truck className="w-4 h-4 text-slate-400" /> Top Suppliers (Purchases)</CardTitle></CardHeader>
              <div className="overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow className="border-b-2 border-slate-100">
                      {['#', 'Supplier', 'Qty Purchased', 'Amount'].map(h => (
                        <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Qty Purchased', 'Amount'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storeData.top_suppliers.map((s, i) => (
                      <TableRow key={i} className="hover:bg-slate-50/50">
                        <TableCell className="text-[11px] text-slate-400 font-medium">{i + 1}</TableCell>
                        <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.supplier}</TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums">{s.qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums font-medium text-sky-700">INR {s.amount.toLocaleString('en-IN')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </>
      )}

      {!selectedStore && summary.length === 0 && (
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardContent className="p-16 text-center">
            <Building2 className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-body">No store data. Upload stock and sales data to see store dashboards.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
