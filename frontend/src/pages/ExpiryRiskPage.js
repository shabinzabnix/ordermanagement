import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { downloadExcel } from '../lib/api';
import { toast } from 'sonner';
import { ShieldAlert, Download, Calendar, ArrowLeft, Search, AlertTriangle, Clock } from 'lucide-react';

export default function ExpiryRiskPage() {
  const [data, setData] = useState(null);
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [monthDetail, setMonthDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (storeFilter !== 'all') params.store_id = storeFilter;
    api.get('/intel/expiry-monthly', { params }).then(r => setData(r.data)).catch(() => toast.error('Failed')).finally(() => setLoading(false));
  }, [storeFilter]);

  const openMonth = (m) => {
    setSelectedMonth(m); setMonthDetail(null); setSearch(''); setDetailLoading(true);
    const params = { month: m.month };
    if (storeFilter !== 'all') params.store_id = storeFilter;
    api.get('/intel/expiry-month-detail', { params }).then(r => setMonthDetail(r.data)).catch(() => toast.error('Failed')).finally(() => setDetailLoading(false));
  };

  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-24 rounded-sm" /><Skeleton className="h-96 rounded-sm" /></div>;

  const s = data?.summary || {};
  const now = new Date();

  const getMonthColor = (month) => {
    const d = new Date(month.month + '-01');
    const diffMs = d - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', ring: 'ring-red-200' };
    if (diffDays <= 30) return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-600', ring: 'ring-red-100' };
    if (diffDays <= 90) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', ring: 'ring-amber-100' };
    if (diffDays <= 180) return { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', ring: 'ring-yellow-100' };
    return { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', ring: 'ring-slate-100' };
  };

  // Filter detail items by search
  const monthItems = (monthDetail?.items || []).filter(i => {
    if (!search) return true;
    const sl = search.toLowerCase();
    return i.product_name?.toLowerCase().includes(sl) || i.batch?.toLowerCase().includes(sl) || i.location?.toLowerCase().includes(sl);
  });

  // Group by store for the drill-down
  const storeGroups = {};
  monthItems.forEach(i => {
    const loc = i.location || 'Unknown';
    if (!storeGroups[loc]) storeGroups[loc] = { items: [], value: 0, count: 0 };
    storeGroups[loc].items.push(i);
    storeGroups[loc].value += i.value;
    storeGroups[loc].count++;
  });

  return (
    <div data-testid="expiry-risk-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {selectedMonth && (
            <Button variant="ghost" size="sm" onClick={() => { setSelectedMonth(null); setMonthDetail(null); setSearch(''); }} className="rounded-sm"><ArrowLeft className="w-4 h-4" /></Button>
          )}
          <div>
            <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">
              {selectedMonth ? selectedMonth.label : 'Expiry Risk Monitor'}
            </h2>
            <p className="text-sm font-body text-slate-500 mt-0.5">
              {selectedMonth ? `${monthItems.length} batches expiring in ${monthDetail?.label || selectedMonth.label}` : 'Batch-wise expiry tracking by month'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={storeFilter} onValueChange={v => { setStoreFilter(v); setSelectedMonth(null); }}>
            <SelectTrigger className="w-[180px] font-body text-sm rounded-sm"><SelectValue placeholder="All Stores" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Locations</SelectItem>{stores.map(st => <SelectItem key={st.id} value={String(st.id)}>{st.store_name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" className="rounded-sm font-body text-xs" onClick={() => downloadExcel('/export/aging', 'expiry_risk.xlsx').catch(() => toast.error('Export failed'))}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { l: 'Total Batches', v: s.total_batches, icon: Calendar, bg: 'bg-slate-50', fg: 'text-slate-600' },
          { l: 'Already Expired', v: s.expired, icon: AlertTriangle, bg: 'bg-red-50', fg: 'text-red-600' },
          { l: 'Within 30 Days', v: s.within_30d, icon: Clock, bg: 'bg-red-50', fg: 'text-red-600' },
          { l: 'Within 90 Days', v: s.within_90d, icon: ShieldAlert, bg: 'bg-amber-50', fg: 'text-amber-600' },
          { l: 'At-Risk Value', v: `INR ${(s.total_value || 0).toLocaleString('en-IN')}`, icon: ShieldAlert, bg: 'bg-violet-50', fg: 'text-violet-600' },
        ].map(k => (
          <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-sm ${k.bg}`}><k.icon className={`w-3.5 h-3.5 ${k.fg}`} strokeWidth={1.75} /></div>
                <div><p className="text-[9px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p><p className="text-lg font-heading font-bold text-slate-900 tabular-nums">{k.v ?? 0}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly Calendar View */}
      {!selectedMonth ? (
        <div className="space-y-3">
          {data?.months?.length === 0 ? (
            <Card className="border-slate-200 rounded-sm"><CardContent className="p-12 text-center"><ShieldAlert className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No expiry dates found. Ensure stock uploads include expiry date column.</p></CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {data?.months?.map(m => {
                const mc = getMonthColor(m);
                return (
                  <Card key={m.month} className={`${mc.border} ${mc.bg} shadow-sm rounded-sm cursor-pointer hover:ring-2 ${mc.ring} transition-all`}
                    onClick={() => openMonth(m)} data-testid={`month-${m.month}`}>
                    <CardContent className="p-4">
                      <p className={`text-[13px] font-heading font-bold ${mc.text}`}>{m.label}</p>
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-[11px] font-body"><span className="text-slate-500">Batches</span><span className={`font-bold tabular-nums ${mc.text}`}>{m.count}</span></div>
                        <div className="flex justify-between text-[11px] font-body"><span className="text-slate-500">Value</span><span className="font-medium tabular-nums text-slate-700">INR {m.value.toLocaleString('en-IN')}</span></div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Drill-down: selected month - store-wise */
        <div className="space-y-3">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input placeholder="Search product, batch or store..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" />
              </div>
            </CardContent>
          </Card>

          {detailLoading ? (
            <div className="space-y-3"><Skeleton className="h-12 rounded-sm" /><Skeleton className="h-48 rounded-sm" /></div>
          ) : Object.entries(storeGroups).sort((a, b) => b[1].count - a[1].count).map(([storeName, group]) => (
            <Card key={storeName} className="border-slate-200 shadow-sm rounded-sm">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                <span className="text-[13px] font-heading font-semibold text-slate-800">{storeName}</span>
                <div className="flex gap-3 text-[11px] font-body">
                  <span className="text-slate-500">{group.count} batches</span>
                  <span className="font-medium text-slate-700">INR {group.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
              <div className="overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow className="border-b border-slate-100">
                      {['Product', 'Product ID', 'Batch', 'Stock', 'MRP', 'Expiry Date', 'Days Left', 'Value'].map(h => (
                        <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-2 ${['Stock', 'MRP', 'Days Left', 'Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((i, idx) => (
                      <TableRow key={idx} className="hover:bg-slate-50/50">
                        <TableCell className="font-body text-[12px] font-medium text-slate-800">{i.product_name}</TableCell>
                        <TableCell className="font-mono text-[10px] text-slate-400">{i.product_id || '-'}</TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-500">{i.batch}</TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums">{i.stock}</TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums">{(i.mrp || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-[11px] text-slate-600 font-medium">{i.expiry_date ? new Date(i.expiry_date).toLocaleDateString() : '-'}</TableCell>
                        <TableCell className="text-right">
                          <span className={`text-[12px] tabular-nums font-medium ${i.days_left < 0 ? 'text-red-600' : i.days_left <= 30 ? 'text-red-500' : i.days_left <= 90 ? 'text-amber-600' : 'text-slate-500'}`}>
                            {i.days_left < 0 ? `${Math.abs(i.days_left)}d expired` : `${i.days_left}d`}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums">INR {i.value.toLocaleString('en-IN')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          ))}
        </div>
      )}    </div>
  );
}
