import { useState } from 'react';
import api from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { Search, Package, Truck, TrendingUp, ArrowLeftRight, Users, RotateCcw, ShoppingCart, Loader2, IndianRupee, Pill } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ProductProfilePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setData(null);
    try {
      const r = await api.get(`/products/${encodeURIComponent(query.trim())}/profile`);
      if (r.data.error) { toast.error(r.data.error); setData(null); }
      else setData(r.data);
    } catch { toast.error('Product not found'); }
    finally { setLoading(false); }
  };

  const p = data?.product;

  return (
    <div data-testid="product-profile-page" className="space-y-5">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900">Product Profile</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">Enter Product ID or Name to view complete details</p>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
                placeholder="Enter Product ID or Product Name..." className="pl-9 font-body text-sm rounded-sm" data-testid="product-search" />
            </div>
            <Button onClick={search} className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-3.5 h-3.5 mr-1.5" />Search</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!data && !loading && (
        <Card className="border-slate-200 rounded-sm"><CardContent className="p-16 text-center">
          <Package className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-body">Search by Product ID (e.g., 39923) or Name (e.g., Paracetamol)</p>
        </CardContent></Card>
      )}

      {loading && <Card className="border-slate-200 rounded-sm"><CardContent className="p-16 text-center"><Loader2 className="w-8 h-8 text-sky-500 animate-spin mx-auto" /></CardContent></Card>}

      {data && p && (
        <>
          {/* Product Header */}
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-heading font-bold text-slate-900">{p.product_name}</h3>
                  <p className="text-[12px] font-mono text-slate-400 mt-0.5">ID: {p.product_id} | {p.category} | {p.sub_category}</p>
                </div>
                <Badge className="text-[11px] rounded-sm bg-sky-50 text-sky-700">Margin: {p.margin_pct}%</Badge>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3">
                {[{l:'MRP',v:p.mrp.toFixed(2)},{l:'PTR',v:p.ptr.toFixed(2)},{l:'L.Cost',v:p.landing_cost.toFixed(2)},
                  {l:'Total Stock',v:data.stock.total.toFixed(1),c:'text-emerald-700'},
                  {l:'90d Sales',v:data.sales_90d.total_qty,c:'text-sky-700'},
                  {l:'All-Time Sales',v:data.sales_all_time.total_qty,c:'text-violet-700'}].map(k => (
                  <div key={k.l} className="p-2 bg-slate-50 rounded-sm"><p className="text-[8px] text-slate-400 uppercase">{k.l}</p>
                    <p className={`text-[14px] font-bold tabular-nums ${k.c || 'text-slate-800'}`}>{k.v}</p></div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Suppliers */}
          {data.suppliers.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {data.suppliers.map((s, i) => <Badge key={i} className="text-[10px] rounded-sm bg-slate-100 text-slate-600">{s.type}: {s.name}</Badge>)}
            </div>
          )}

          {/* Stock */}
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-4">
              <p className="text-[10px] font-body text-emerald-700 uppercase tracking-wider mb-2"><Package className="w-3 h-3 inline mr-1" />Stock Distribution</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="p-2 bg-emerald-50 rounded-sm border border-emerald-100"><p className="text-[9px] text-slate-400">HO</p><p className="text-[16px] font-bold tabular-nums">{data.stock.ho}</p></div>
                {data.stock.stores.map((s, i) => (
                  <div key={i} className="p-2 bg-white rounded-sm border border-slate-100"><p className="text-[9px] text-slate-400">{s.store}</p><p className="text-[16px] font-bold tabular-nums">{s.stock}</p></div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="sales" className="space-y-3">
            <TabsList className="rounded-sm">
              <TabsTrigger value="sales" className="rounded-sm text-xs font-body">Sales ({data.sales_all_time.by_store.length})</TabsTrigger>
              <TabsTrigger value="purchases" className="rounded-sm text-xs font-body">Purchases ({data.purchases_all_time.by_store.length})</TabsTrigger>
              <TabsTrigger value="customers" className="rounded-sm text-xs font-body">Customers ({data.customers.length})</TabsTrigger>
              <TabsTrigger value="transfers" className="rounded-sm text-xs font-body">Transfers ({data.transfers.length})</TabsTrigger>
              <TabsTrigger value="recalls" className="rounded-sm text-xs font-body">Recalls ({data.recalls.length})</TabsTrigger>
              <TabsTrigger value="requests" className="rounded-sm text-xs font-body">Requests ({data.requests.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="sales">
              <Card className="border-slate-200 rounded-sm">
                <div className="px-4 py-2 bg-slate-50 border-b flex justify-between text-[12px] font-body">
                  <span>All-Time: <strong>{data.sales_all_time.total_qty}</strong> qty | INR <strong>{data.sales_all_time.total_amount.toLocaleString('en-IN')}</strong></span>
                  <span>90 Days: <strong>{data.sales_90d.total_qty}</strong> qty | INR <strong>{data.sales_90d.total_amount.toLocaleString('en-IN')}</strong></span>
                </div>
                <Table><TableHeader><TableRow>{['Store', 'Qty Sold', 'Amount', 'Invoices'].map(h => <TableHead key={h} className="text-[9px] uppercase font-bold text-slate-400 py-2">{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{data.sales_all_time.by_store.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-sm text-slate-400">No sales</TableCell></TableRow> :
                    data.sales_all_time.by_store.map((s, i) => <TableRow key={i}><TableCell className="text-[12px] font-medium">{s.store}</TableCell><TableCell className="text-[12px] tabular-nums">{s.qty}</TableCell><TableCell className="text-[12px] tabular-nums text-emerald-700">INR {s.amount.toLocaleString('en-IN')}</TableCell><TableCell className="text-[12px] tabular-nums">{s.invoices}</TableCell></TableRow>)}
                  </TableBody></Table>
              </Card>
            </TabsContent>

            <TabsContent value="purchases">
              <Card className="border-slate-200 rounded-sm">
                <div className="px-4 py-2 bg-slate-50 border-b text-[12px] font-body">
                  All-Time: <strong>{data.purchases_all_time.total_qty}</strong> qty | INR <strong>{data.purchases_all_time.total_amount.toLocaleString('en-IN')}</strong>
                </div>
                <Table><TableHeader><TableRow>{['Store', 'Qty Purchased', 'Amount'].map(h => <TableHead key={h} className="text-[9px] uppercase font-bold text-slate-400 py-2">{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{data.purchases_all_time.by_store.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center py-8 text-sm text-slate-400">No purchases</TableCell></TableRow> :
                    data.purchases_all_time.by_store.map((p, i) => <TableRow key={i}><TableCell className="text-[12px] font-medium">{p.store}</TableCell><TableCell className="text-[12px] tabular-nums">{p.qty}</TableCell><TableCell className="text-[12px] tabular-nums text-violet-700">INR {p.amount.toLocaleString('en-IN')}</TableCell></TableRow>)}
                  </TableBody></Table>
              </Card>
            </TabsContent>

            <TabsContent value="customers">
              <Card className="border-slate-200 rounded-sm">
                <Table><TableHeader><TableRow>{['Customer', 'Mobile', 'Times Purchased', 'Total Spent'].map(h => <TableHead key={h} className="text-[9px] uppercase font-bold text-slate-400 py-2">{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{data.customers.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-sm text-slate-400">No customers</TableCell></TableRow> :
                    data.customers.map((c, i) => <TableRow key={i} className="cursor-pointer hover:bg-slate-50" onClick={() => c.customer_id && navigate(`/crm/customer/${c.customer_id}`)}>
                      <TableCell className="text-[12px] font-medium text-sky-700">{c.name}</TableCell><TableCell className="font-mono text-[11px] text-slate-500">{c.mobile}</TableCell>
                      <TableCell className="text-[12px] tabular-nums font-bold">{c.purchases}</TableCell><TableCell className="text-[12px] tabular-nums text-emerald-700">INR {c.spent.toLocaleString('en-IN')}</TableCell></TableRow>)}
                  </TableBody></Table>
              </Card>
            </TabsContent>

            <TabsContent value="transfers">
              <Card className="border-slate-200 rounded-sm">
                <Table><TableHeader><TableRow>{['From', 'To', 'Qty', 'Status', 'Date'].map(h => <TableHead key={h} className="text-[9px] uppercase font-bold text-slate-400 py-2">{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{data.transfers.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-slate-400">No transfers</TableCell></TableRow> :
                    data.transfers.map((t, i) => <TableRow key={i}><TableCell className="text-[12px]">{t.from}</TableCell><TableCell className="text-[12px]">{t.to}</TableCell>
                      <TableCell className="text-[12px] tabular-nums">{t.qty}</TableCell><TableCell><Badge className="text-[9px] rounded-sm">{t.status}</Badge></TableCell>
                      <TableCell className="text-[11px] text-slate-400">{t.date ? new Date(t.date).toLocaleDateString() : '-'}</TableCell></TableRow>)}
                  </TableBody></Table>
              </Card>
            </TabsContent>

            <TabsContent value="recalls">
              <Card className="border-slate-200 rounded-sm">
                <Table><TableHeader><TableRow>{['Store', 'Qty', 'Status', 'Date'].map(h => <TableHead key={h} className="text-[9px] uppercase font-bold text-slate-400 py-2">{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{data.recalls.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-sm text-slate-400">No recalls</TableCell></TableRow> :
                    data.recalls.map((r, i) => <TableRow key={i}><TableCell className="text-[12px]">{r.store}</TableCell><TableCell className="text-[12px] tabular-nums">{r.qty}</TableCell>
                      <TableCell><Badge className="text-[9px] rounded-sm">{r.status}</Badge></TableCell>
                      <TableCell className="text-[11px] text-slate-400">{r.date ? new Date(r.date).toLocaleDateString() : '-'}</TableCell></TableRow>)}
                  </TableBody></Table>
              </Card>
            </TabsContent>

            <TabsContent value="requests">
              <Card className="border-slate-200 rounded-sm">
                <Table><TableHeader><TableRow>{['Store', 'Qty', 'Status', 'Date'].map(h => <TableHead key={h} className="text-[9px] uppercase font-bold text-slate-400 py-2">{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{data.requests.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-sm text-slate-400">No requests</TableCell></TableRow> :
                    data.requests.map((r, i) => <TableRow key={i}><TableCell className="text-[12px]">{r.store}</TableCell><TableCell className="text-[12px] tabular-nums">{r.qty}</TableCell>
                      <TableCell><Badge className="text-[9px] rounded-sm">{r.status}</Badge></TableCell>
                      <TableCell className="text-[11px] text-slate-400">{r.date ? new Date(r.date).toLocaleDateString() : '-'}</TableCell></TableRow>)}
                  </TableBody></Table>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
