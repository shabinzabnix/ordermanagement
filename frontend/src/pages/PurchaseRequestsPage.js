import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { ShoppingCart, Plus, AlertTriangle, Download } from 'lucide-react';
import { downloadExcel } from '../lib/api';

export default function PurchaseRequestsPage() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('registered');
  const [form, setForm] = useState({
    store_id: '', product_id: '', product_name: '', brand_name: '',
    quantity: '', customer_name: '', customer_contact: '', is_registered_product: true,
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const loadPurchases = () => { api.get('/purchases').then(r => setPurchases(r.data.purchases)).catch(() => {}); };
  useEffect(() => { loadPurchases(); }, []);
  useEffect(() => {
    api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {});
    api.get('/products', { params: { limit: 500 } }).then(r => setProducts(r.data.products)).catch(() => {});
  }, []);
  // Auto-set store for store_staff
  useEffect(() => {
    if (user?.role === 'STORE_STAFF' && user?.store_id && !form.store_id) {
      setForm(f => ({ ...f, store_id: String(user.store_id) }));
    }
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      const payload = {
        store_id: parseInt(form.store_id),
        product_name: form.product_name,
        quantity: parseFloat(form.quantity),
        customer_name: form.customer_name,
        customer_contact: form.customer_contact,
        is_registered_product: tab === 'registered',
      };
      if (tab === 'registered') payload.product_id = form.product_id;
      else payload.brand_name = form.brand_name;

      const res = await api.post('/purchases', payload);
      setResult(res.data);
      if (res.data.status === 'transfer_suggested') {
        toast.warning('Stock available in network - transfer suggested');
      } else {
        toast.success('Purchase request created');
      }
      loadPurchases();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const statusColor = (s) => {
    if (s === 'approved') return 'bg-emerald-50 text-emerald-700';
    if (s === 'rejected') return 'bg-red-50 text-red-700';
    if (s === 'transfer_suggested') return 'bg-amber-50 text-amber-700';
    return 'bg-slate-100 text-slate-700';
  };

  return (
    <div data-testid="purchases-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Purchase Requests</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Create and validate purchase requests</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResult(null); }}>
          <DialogTrigger asChild>
            <Button data-testid="create-purchase-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Request
            </Button>
          </DialogTrigger>
          <Button variant="outline" className="rounded-sm font-body text-xs ml-2" data-testid="export-purchases-btn"
            onClick={() => downloadExcel('/export/purchases', 'purchases.xlsx').catch(() => toast.error('Export failed'))}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
          <DialogContent className="rounded-sm max-w-lg">
            <DialogHeader><DialogTitle className="font-heading">Create Purchase Request</DialogTitle></DialogHeader>
            <Tabs value={tab} onValueChange={v => { setTab(v); setResult(null); }}>
              <TabsList className="grid w-full grid-cols-2 rounded-sm">
                <TabsTrigger value="registered" className="rounded-sm text-xs font-body" data-testid="tab-registered">Registered Product</TabsTrigger>
                <TabsTrigger value="non-registered" className="rounded-sm text-xs font-body" data-testid="tab-non-registered">Non-Registered</TabsTrigger>
              </TabsList>
              <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Store *</Label>
                  <Select value={form.store_id} onValueChange={v => setForm({...form, store_id: v})} disabled={user?.role === 'STORE_STAFF'}>
                    <SelectTrigger className="rounded-sm" data-testid="purchase-store"><SelectValue placeholder="Select store" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <TabsContent value="registered" className="mt-0 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="font-body text-xs">Product *</Label>
                    <Select value={form.product_id} onValueChange={v => {
                      const p = products.find(p => p.product_id === v);
                      setForm({...form, product_id: v, product_name: p?.product_name || ''});
                    }}>
                      <SelectTrigger className="rounded-sm" data-testid="purchase-product"><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>{products.map(p => <SelectItem key={p.product_id} value={p.product_id}>{p.product_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </TabsContent>
                <TabsContent value="non-registered" className="mt-0 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="font-body text-xs">Product Name *</Label>
                    <Input data-testid="purchase-name" value={form.product_name} onChange={e => setForm({...form, product_name: e.target.value})} className="rounded-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-body text-xs">Brand Name</Label>
                    <Input data-testid="purchase-brand" value={form.brand_name} onChange={e => setForm({...form, brand_name: e.target.value})} className="rounded-sm" />
                  </div>
                </TabsContent>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="font-body text-xs">Quantity *</Label>
                    <Input data-testid="purchase-qty" type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required className="rounded-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-body text-xs">Customer Name *</Label>
                    <Input data-testid="purchase-customer" value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} required className="rounded-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-body text-xs">Contact *</Label>
                    <Input data-testid="purchase-contact" value={form.customer_contact} onChange={e => setForm({...form, customer_contact: e.target.value})} required className="rounded-sm" />
                  </div>
                </div>

                {result && result.status === 'transfer_suggested' && result.network_stock_info && (
                  <Card className="border-amber-200 bg-amber-50/50 rounded-sm">
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-body font-medium text-amber-800">Stock available in network!</p>
                          <p className="text-[11px] font-body text-amber-700 mt-1">
                            HO: {result.network_stock_info.ho_stock} units
                            {result.network_stock_info.store_stock && Object.entries(result.network_stock_info.store_stock).map(([store, qty]) => (
                              <span key={store}> | {store}: {qty}</span>
                            ))}
                          </p>
                          <p className="text-[11px] font-body text-amber-600 mt-1">Consider requesting an inter-store transfer instead.</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <DialogFooter>
                  <Button type="submit" data-testid="submit-purchase-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>
                    {saving ? 'Creating...' : 'Submit Request'}
                  </Button>
                </DialogFooter>
              </form>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['ID', 'Store', 'Product', 'Qty', 'Customer', 'Type', 'Status', 'Date'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16">
                  <ShoppingCart className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No purchase requests</p>
                </TableCell></TableRow>
              ) : purchases.map(p => (
                <TableRow key={p.id} className="hover:bg-slate-50/50" data-testid={`purchase-row-${p.id}`}>
                  <TableCell className="font-mono text-[11px] text-slate-500">#{p.id}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-600">{p.store_name}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{p.product_name}</TableCell>
                  <TableCell className="text-[12px] tabular-nums">{p.quantity}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{p.customer_name}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px] rounded-sm">{p.is_registered_product ? 'Registered' : 'New'}</Badge></TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${statusColor(p.status)}`}>{p.status?.replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-[11px] text-slate-400">{p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
