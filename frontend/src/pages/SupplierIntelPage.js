import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Truck, Search, TrendingDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function SupplierIntelPage() {
  const [data, setData] = useState({ suppliers: [], best_per_product: [], total_suppliers: 0, total_best_per_product: 0 });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 100;
  const timerRef = useRef(null);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 500);
  };

  useEffect(() => {
    setLoading(true);
    const params = { page, limit };
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/intel/supplier-intelligence', { params }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  if (loading && page === 1) return <div className="space-y-4"><Skeleton className="h-16 rounded-sm" /><Skeleton className="h-96 rounded-sm" /></div>;

  const topSuppliers = data.suppliers.slice(0, 12).map(s => ({ name: s.supplier?.length > 15 ? s.supplier.slice(0, 15) + '..' : s.supplier, products: s.product_count }));
  const totalSupPages = Math.ceil((data.total_suppliers || 0) / limit);
  const totalBestPages = Math.ceil((data.total_best_per_product || 0) / limit);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (<div className="bg-white border border-slate-200 rounded-sm p-2.5 shadow-md">
      <p className="text-[11px] font-heading font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} className="text-[11px] font-body text-slate-500">{p.dataKey}: <span className="font-medium text-slate-800">{p.value}</span></p>)}
    </div>);
  };

  const Pagination = ({ total, label }) => (
    total > 1 && (
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
        <p className="text-[11px] text-slate-400 font-body">Page {page}/{total} | {label}</p>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="h-7 w-7 p-0 rounded-sm"><ChevronLeft className="w-3.5 h-3.5" /></Button>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(total, p+1))} disabled={page === total} className="h-7 w-7 p-0 rounded-sm"><ChevronRight className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
    )
  );

  return (
    <div data-testid="supplier-intel-page" className="space-y-5">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Supplier Intelligence</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">{data.total_suppliers} suppliers | {data.total_best_per_product} products with supplier data</p>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Search suppliers or products..." value={search} onChange={e => handleSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" data-testid="supplier-search" /></div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="rounded-sm">
          <TabsTrigger value="overview" className="rounded-sm text-xs font-body">Supplier Overview ({data.total_suppliers})</TabsTrigger>
          <TabsTrigger value="best" className="rounded-sm text-xs font-body">Best Supplier per Product ({data.total_best_per_product})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {topSuppliers.length > 0 && !search && (
            <Card className="border-slate-200 shadow-sm rounded-sm">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Top Suppliers by Product Coverage</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topSuppliers} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                    <YAxis tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="products" fill="#0EA5E9" radius={[3, 3, 0, 0]} name="Products" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-400px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Supplier', 'Products', 'Avg PTR', 'Avg Landing Cost'].map(h => (
                      <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${h !== 'Supplier' ? 'text-right' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.suppliers.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-16"><Truck className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No supplier data</p></TableCell></TableRow>
                  ) : data.suppliers.map((s, i) => (
                    <TableRow key={i} className="hover:bg-slate-50/50">
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.supplier}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums font-medium">{s.product_count.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{s.avg_ptr.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{s.avg_landing_cost.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination total={totalSupPages} label={`${data.total_suppliers} suppliers`} />
          </Card>
        </TabsContent>

        <TabsContent value="best" className="space-y-4">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-340px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Product ID', 'Product', 'Best Supplier', 'PTR', 'Landing Cost', 'MRP', 'Margin %'].map(h => (
                      <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['PTR', 'Landing Cost', 'MRP', 'Margin %'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.best_per_product.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-16"><TrendingDown className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No recommendations</p></TableCell></TableRow>
                  ) : data.best_per_product.map((p, i) => (
                    <TableRow key={i} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-[11px] text-slate-500">{p.product_id}</TableCell>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800 max-w-[200px] truncate">{p.product_name}</TableCell>
                      <TableCell className="text-[12px] text-sky-700 font-medium">{p.best_supplier}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{p.ptr.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{p.landing_cost.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{p.mrp.toFixed(2)}</TableCell>
                      <TableCell className="text-right"><Badge className={`text-[10px] rounded-sm ${p.margin_pct > 20 ? 'bg-emerald-50 text-emerald-700' : p.margin_pct > 10 ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>{p.margin_pct}%</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination total={totalBestPages} label={`${data.total_best_per_product} products`} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
