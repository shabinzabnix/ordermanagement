import { useState, useEffect, useRef } from 'react';
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
import { ShoppingCart, Plus, AlertTriangle, Download, Search } from 'lucide-react';
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
    purchase_reason: 'customer_enquiry',
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef(null);

  const loadPurchases = () => { api.get('/purchases').then(r => setPurchases(r.data.purchases)).catch(() => {}); };
  useEffect(() => { loadPurchases(); }, []);
  useEffect(() => {
    api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {});
  }, []);
  useEffect(() => {
    if (user?.role === 'STORE_STAFF' && user?.store_id && !form.store_id) {
      setForm(f => ({ ...f, store_id: String(user.store_id) }));
    }
  }, [user]);

  // Product search with debounce
  useEffect(() => {
    if (productSearch.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(() => {
      api.get('/products', { params: { search: productSearch, limit: 15 } })
        .then(r => { setSuggestions(r.data.products); setShowSuggestions(true); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => { if (suggestRef.current && !suggestRef.current.contains(e.target)) setShowSuggestions(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
        purchase_reason: form.purchase_reason,
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
                  <div className="space-y-1.5" ref={suggestRef}>
                    <Label className="font-body text-xs">Product * <span className="text-slate-400 font-normal">(type to search)</span></Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <Input
                        data-testid="purchase-product-search"
                        placeholder="Search by product name or ID..."
                        value={productSearch}
                        onChange={e => { setProductSearch(e.target.value); if (!e.target.value) setForm({...form, product_id: '', product_name: ''}); }}
                        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                        className="rounded-sm pl-9 font-body"
                        autoComplete="off"
                      />
                      {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-[200px] overflow-auto">
                          {suggestions.map(p => (
                            <button
                              key={p.product_id}
                              type="button"
                              data-testid={`suggest-${p.product_id}`}
                              className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
                              onClick={() => {
                                setForm({...form, product_id: p.product_id, product_name: p.product_name});
                                setProductSearch(p.product_name);
                                setShowSuggestions(false);
                              }}
                            >
                              <p className="text-[13px] font-body font-medium text-slate-800">{p.product_name}</p>
                              <p className="text-[10px] font-mono text-slate-400">{p.product_id} | MRP: {p.mrp} | {p.category || 'No category'}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {form.product_id && (
                      <p className="text-[10px] font-body text-emerald-600">Selected: {form.product_name} ({form.product_id})</p>
                    )}
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
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Purchase Reason *</Label>
                  <Select value={form.purchase_reason} onValueChange={v => setForm({...form, purchase_reason: v})}>
                    <SelectTrigger className="rounded-sm" data-testid="purchase-reason"><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer_enquiry">Customer Enquiry</SelectItem>
                      <SelectItem value="stock_refill">Stock Refill</SelectItem>
                      <SelectItem value="emergency_purchase">Emergency Purchase</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                {['ID', 'Store', 'Product', 'Qty', 'Reason', 'Customer', 'Status', 'Date'].map(h => (
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
                  <TableCell><Badge className={`text-[10px] rounded-sm ${
                    p.purchase_reason === 'emergency_purchase' ? 'bg-red-50 text-red-700' :
                    p.purchase_reason === 'stock_refill' ? 'bg-sky-50 text-sky-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{(p.purchase_reason || 'customer_enquiry').replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{p.customer_name}</TableCell>
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
