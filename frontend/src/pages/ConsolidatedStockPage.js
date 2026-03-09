import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Search, BarChart3, Download, Package, Truck, TrendingUp, ArrowLeftRight, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { downloadExcel } from '../lib/api';
import { toast } from 'sonner';
import { useSales90d, Sales90dBadge } from '../hooks/useSales90d';
import { Pagination } from '../components/Pagination';

export default function ConsolidatedStockPage() {
  const [data, setData] = useState({ consolidated: [], stores: [] });
  const salesMap = useSales90d(data.consolidated.map(p => p.product_name));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const openProfile = (productId) => {
    if (!productId || productId === 'LOCAL') return;
    setProfileOpen(true); setProfile(null); setProfileLoading(true);
    api.get(`/products/${productId}/profile`).then(r => setProfile(r.data)).catch(() => toast.error('Failed')).finally(() => setProfileLoading(false));
  };
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/products/categories').then(r => setCategories(r.data.categories)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page, limit };
    if (search) params.search = search;
    if (category) params.category = category;
    api.get('/stock/consolidated', { params })
      .then(r => { setData(r.data); setTotal(r.data.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, category, page]);

  return (
    <div data-testid="consolidated-stock-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Consolidated Stock</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Network-wide inventory across all locations</p>
        </div>
        <Button variant="outline" className="rounded-sm font-body text-xs" data-testid="export-consolidated-btn"
          onClick={() => downloadExcel('/export/consolidated', 'consolidated.xlsx').catch(() => toast.error('Export failed'))}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export
        </Button>
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
                <TableHead className="text-[10px] uppercase tracking-wider font-bold text-amber-500 font-body py-3 text-right">90d Sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.consolidated.length === 0 ? (
                <TableRow><TableCell colSpan={3 + data.stores.length + 1} className="text-center py-16">
                  <BarChart3 className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No consolidated data. Upload product master and stock data first.</p>
                </TableCell></TableRow>
              ) : data.consolidated.map((p, idx) => (
                <TableRow key={`${p.product_id}-${idx}`} className={`hover:bg-slate-50/50 ${p.is_local ? 'bg-amber-50/30' : ''}`}>
                  <TableCell className="font-mono text-[11px] text-slate-500">{p.is_local ? <Badge className="text-[8px] rounded-sm bg-amber-100 text-amber-700">LOCAL</Badge> : p.product_id}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600 hover:underline" onClick={() => openProfile(p.product_id)}>{p.product_name}</TableCell>
                  <TableCell className="text-right font-body text-[12px] tabular-nums">{p.ho_stock > 0 ? p.ho_stock.toLocaleString() : <span className="text-slate-300">0</span>}</TableCell>
                  {data.stores.map(s => {
                    const qty = p.store_stock[String(s.id)] || 0;
                    return <TableCell key={s.id} className="text-right font-body text-[12px] tabular-nums">{qty > 0 ? (qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(1)) : <span className="text-slate-300">0</span>}</TableCell>;
                  })}
                  <TableCell className="text-right font-body text-[12px] tabular-nums font-bold text-sky-700">{p.total > 0 ? (p.total % 1 === 0 ? p.total.toFixed(0) : p.total.toFixed(1)) : '0'}</TableCell>
                  <TableCell className="text-right"><Sales90dBadge name={p.product_name} salesMap={salesMap} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} label="products" />
      </Card>

      {/* Product Profile Popup */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="rounded-sm max-w-2xl max-h-[85vh] overflow-auto p-0">
          {profileLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 text-sky-500 animate-spin mx-auto" /><p className="text-sm text-slate-400 mt-2">Loading product details...</p></div>
          ) : profile?.product ? (
            <>
              <DialogHeader className="px-5 pt-5 pb-0"><DialogTitle className="font-heading">{profile.product.product_name}</DialogTitle></DialogHeader>
              <div className="px-5 pb-5 space-y-4">
                {/* Pricing & IDs */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {[
                    { l: 'MRP', v: `${profile.product.mrp.toFixed(2)}` },
                    { l: 'PTR', v: `${profile.product.ptr.toFixed(2)}` },
                    { l: 'L.Cost', v: `${profile.product.landing_cost.toFixed(2)}` },
                    { l: 'Margin', v: `${profile.product.margin_pct}%`, c: profile.product.margin_pct > 20 ? 'text-emerald-700' : 'text-amber-700' },
                    { l: 'Category', v: profile.product.category || '-' },
                    { l: 'HO ID', v: profile.product.product_id },
                  ].map(k => (
                    <div key={k.l} className="p-2 bg-slate-50 rounded-sm"><p className="text-[8px] text-slate-400 uppercase">{k.l}</p><p className={`text-[13px] font-bold tabular-nums ${k.c || 'text-slate-800'}`}>{k.v}</p></div>
                  ))}
                </div>

                {/* Suppliers */}
                {profile.suppliers?.length > 0 && (
                  <div className="p-3 bg-sky-50/50 border border-sky-200 rounded-sm">
                    <p className="text-[10px] font-body text-sky-700 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Truck className="w-3 h-3" /> Suppliers</p>
                    <div className="grid grid-cols-2 gap-1">
                      {profile.suppliers.map((s, i) => (
                        <div key={i} className="text-[11px] font-body"><span className="text-slate-400">{s.type}:</span> <span className="font-medium text-slate-700">{s.name}</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stock */}
                <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-body text-emerald-700 uppercase tracking-wider flex items-center gap-1"><Package className="w-3 h-3" /> Stock</p>
                    <span className="text-[13px] font-bold text-emerald-800 tabular-nums">Total: {profile.stock.total.toFixed(1)}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                    <div className="text-[11px] font-body p-1.5 bg-white rounded-sm border border-emerald-100"><span className="text-slate-400">HO:</span> <span className="font-bold tabular-nums">{profile.stock.ho}</span></div>
                    {profile.stock.stores.map((s, i) => (
                      <div key={i} className="text-[11px] font-body p-1.5 bg-white rounded-sm border border-emerald-100"><span className="text-slate-400">{s.store}:</span> <span className="font-bold tabular-nums">{s.stock}</span></div>
                    ))}
                  </div>
                </div>

                {/* Sales & Purchases 90d side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border border-slate-200 rounded-sm">
                    <p className="text-[10px] font-body text-sky-700 uppercase tracking-wider mb-1.5 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Sales (90d)</p>
                    <div className="flex justify-between text-[12px] font-body mb-1"><span className="text-slate-500">Qty:</span><span className="font-bold tabular-nums">{profile.sales_90d.total_qty}</span></div>
                    <div className="flex justify-between text-[12px] font-body mb-2"><span className="text-slate-500">Amount:</span><span className="font-bold tabular-nums text-emerald-700">INR {profile.sales_90d.total_amount.toLocaleString('en-IN')}</span></div>
                    {profile.sales_90d.by_store?.map((s, i) => (
                      <div key={i} className="flex justify-between text-[10px] font-body text-slate-500 py-0.5 border-t border-slate-50"><span>{s.store}</span><span className="tabular-nums">{s.qty} qty | INR {s.amount}</span></div>
                    ))}
                  </div>
                  <div className="p-3 border border-slate-200 rounded-sm">
                    <p className="text-[10px] font-body text-violet-700 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Package className="w-3 h-3" /> Purchases (90d)</p>
                    <div className="flex justify-between text-[12px] font-body mb-1"><span className="text-slate-500">Qty:</span><span className="font-bold tabular-nums">{profile.purchases_90d.total_qty}</span></div>
                    <div className="flex justify-between text-[12px] font-body mb-2"><span className="text-slate-500">Amount:</span><span className="font-bold tabular-nums text-violet-700">INR {profile.purchases_90d.total_amount.toLocaleString('en-IN')}</span></div>
                    {profile.purchases_90d.by_store?.map((s, i) => (
                      <div key={i} className="flex justify-between text-[10px] font-body text-slate-500 py-0.5 border-t border-slate-50"><span>{s.store}</span><span className="tabular-nums">{s.qty} qty | INR {s.amount}</span></div>
                    ))}
                  </div>
                </div>

                {/* Transfers */}
                {profile.transfers?.length > 0 && (
                  <div className="p-3 border border-slate-200 rounded-sm">
                    <p className="text-[10px] font-body text-amber-700 uppercase tracking-wider mb-1.5 flex items-center gap-1"><ArrowLeftRight className="w-3 h-3" /> Recent Transfers</p>
                    {profile.transfers.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] font-body py-1 border-t border-slate-50 first:border-0">
                        <span className="text-slate-600">{t.from}</span><span className="text-slate-300">&rarr;</span><span className="text-slate-600">{t.to}</span>
                        <span className="tabular-nums font-medium ml-auto">{t.qty}</span>
                        <Badge className={`text-[8px] rounded-sm ${t.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : t.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{t.status}</Badge>
                        <span className="text-[9px] text-slate-300">{t.date ? new Date(t.date).toLocaleDateString() : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : <div className="p-12 text-center text-sm text-slate-400">Product not found</div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
