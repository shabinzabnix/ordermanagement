import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Search, BarChart3 } from 'lucide-react';

export default function ConsolidatedStockPage() {
  const [data, setData] = useState({ consolidated: [], stores: [] });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/products/categories').then(r => setCategories(r.data.categories)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page: 1, limit: 50 };
    if (search) params.search = search;
    if (category) params.category = category;
    api.get('/stock/consolidated', { params })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, category]);

  return (
    <div data-testid="consolidated-stock-page" className="space-y-5">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Consolidated Stock</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">Network-wide inventory across all locations</p>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input data-testid="consolidated-search" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" />
            </div>
            <Select value={category || 'all'} onValueChange={v => setCategory(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-[180px] font-body text-sm rounded-sm"><SelectValue placeholder="All Categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-300px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">Product ID</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">Product Name</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 text-right">HO Stock</TableHead>
                {data.stores.map(s => (
                  <TableHead key={s.id} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 text-right">{s.store_code || s.store_name}</TableHead>
                ))}
                <TableHead className="text-[10px] uppercase tracking-wider font-bold text-sky-500 font-body py-3 text-right">TOTAL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.consolidated.length === 0 ? (
                <TableRow><TableCell colSpan={3 + data.stores.length + 1} className="text-center py-16">
                  <BarChart3 className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No consolidated data. Upload product master and stock data first.</p>
                </TableCell></TableRow>
              ) : data.consolidated.map(p => (
                <TableRow key={p.product_id} className="hover:bg-slate-50/50">
                  <TableCell className="font-mono text-[11px] text-slate-500">{p.product_id}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{p.product_name}</TableCell>
                  <TableCell className="text-right font-body text-[12px] tabular-nums">{p.ho_stock > 0 ? p.ho_stock.toLocaleString() : <span className="text-slate-300">0</span>}</TableCell>
                  {data.stores.map(s => {
                    const qty = p.store_stock[String(s.id)] || 0;
                    return <TableCell key={s.id} className="text-right font-body text-[12px] tabular-nums">{qty > 0 ? qty.toFixed(0) : <span className="text-slate-300">0</span>}</TableCell>;
                  })}
                  <TableCell className="text-right font-body text-[12px] tabular-nums font-bold text-sky-700">{p.total > 0 ? p.total.toFixed(0) : '0'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
