import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { downloadExcel } from '../lib/api';
import { toast } from 'sonner';
import { TrendingUp, Search, Download, ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function TopSellingPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('all');
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('revenue');
  const limit = 50;

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);
  useEffect(() => {
    if (user?.role === 'STORE_STAFF' && user?.store_id) setSelectedStore(String(user.store_id));
  }, [user]);

  useEffect(() => {
    setLoading(true);
    const params = { page, limit, date_from: dateFrom, date_to: dateTo, sort_by: sortBy };
    if (selectedStore !== 'all') params.store_id = selectedStore;
    if (search) params.search = search;
    api.get('/intel/top-selling', { params }).then(r => { setProducts(r.data.products); setTotal(r.data.total); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [selectedStore, dateFrom, dateTo, search, page, sortBy]);

  const totalPages = Math.ceil(total / limit);
  const chartData = products.slice(0, 10).map(p => ({
    name: p.product_name?.length > 20 ? p.product_name.slice(0, 20) + '..' : p.product_name,
    revenue: p.total_amount, qty: p.total_qty,
  }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (<div className="bg-white border border-slate-200 rounded-sm p-2.5 shadow-md">
      <p className="text-[11px] font-heading font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} className="text-[11px] font-body text-slate-500">{p.name}: <span className="font-medium text-slate-800">{typeof p.value === 'number' ? p.value.toLocaleString('en-IN') : p.value}</span></p>)}
    </div>);
  };

  return (
    <div data-testid="top-selling-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Top Selling Products</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Store-wise and date-wise product sales ranking</p>
        </div>
        <Button variant="outline" className="rounded-sm font-body text-xs" data-testid="export-top-selling"
          onClick={() => {
            const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, sort_by: sortBy });
            if (selectedStore !== 'all') params.append('store_id', selectedStore);
            downloadExcel(`/intel/export-top-selling?${params}`, 'top_selling.xlsx').catch(() => toast.error('Export failed'));
          }}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3 flex-wrap items-end">
          <div className="space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">Store</label>
            <Select value={selectedStore} onValueChange={v => { setSelectedStore(v); setPage(1); }} disabled={user?.role === 'STORE_STAFF'}>
              <SelectTrigger className="w-[200px] font-body text-sm rounded-sm" data-testid="top-store-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">From</label>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="w-[145px] font-body text-sm rounded-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">To</label>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="w-[145px] font-body text-sm rounded-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">Sort</label>
            <Select value={sortBy} onValueChange={v => { setSortBy(v); setPage(1); }}>
              <SelectTrigger className="w-[140px] font-body text-sm rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="revenue">By Revenue</SelectItem>
                <SelectItem value="qty">By Quantity</SelectItem>
                <SelectItem value="invoices">By Invoices</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative flex-1 min-w-[200px] space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">Search</label>
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input data-testid="top-search" placeholder="Search product..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 font-body text-sm rounded-sm" /></div>
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      {!loading && chartData.length > 0 && (
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Top 10 by Revenue</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="revenue" fill="#10B981" radius={[3, 3, 0, 0]} name="Revenue (INR)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-420px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['#', 'Product', 'Product ID', selectedStore === 'all' ? 'Stores' : '', 'Qty Sold', 'Invoices', 'Revenue', 'Avg Price'].filter(Boolean).map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Qty Sold', 'Invoices', 'Revenue', 'Avg Price', 'Stores'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? [...Array(10)].map((_, i) => (
                <TableRow key={i}>{[...Array(7)].map((_, j) => <TableCell key={j}><div className="h-4 bg-slate-50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : products.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16">
                  <Package className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No sales data for this period</p>
                </TableCell></TableRow>
              ) : products.map((p, i) => (
                <TableRow key={i} className="hover:bg-slate-50/50" data-testid={`top-row-${i}`}>
                  <TableCell className="text-[11px] text-slate-400 font-medium w-[40px]">{(page - 1) * limit + i + 1}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 max-w-[250px] truncate">{p.product_name}</TableCell>
                  <TableCell className="font-mono text-[10px] text-slate-400">{p.product_id || '-'}</TableCell>
                  {selectedStore === 'all' && <TableCell className="text-right text-[12px] tabular-nums">{p.store_count}</TableCell>}
                  <TableCell className="text-right text-[12px] tabular-nums font-medium">{p.total_qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{p.invoice_count.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium text-emerald-700">INR {p.total_amount.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums text-slate-500">INR {p.avg_price.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} | {total.toLocaleString()} products</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="h-7 w-7 p-0 rounded-sm"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages} className="h-7 w-7 p-0 rounded-sm"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
