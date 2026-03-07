import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { ShoppingCart, Search, Trash2 } from 'lucide-react';

export default function StoreRequestPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [requests, setRequests] = useState([]);
  const [reason, setReason] = useState('');
  const [storeId, setStoreId] = useState('');
  const [custName, setCustName] = useState('');
  const [custMobile, setCustMobile] = useState('');
  const [items, setItems] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [saving, setSaving] = useState(false);
  const sugRef = useRef(null);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); loadRequests(); }, []);
  useEffect(() => { if (user?.role === 'STORE_STAFF' && user?.store_id) setStoreId(String(user.store_id)); }, [user]);

  const loadRequests = () => { api.get('/po/store-requests').then(r => setRequests(r.data.requests)).catch(() => {}); };

  useEffect(() => {
    if (productSearch.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => { api.get('/products', { params: { search: productSearch, limit: 15 } }).then(r => { setSuggestions(r.data.products); setShowSugg(true); }).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);
  useEffect(() => {
    const h = (e) => { if (sugRef.current && !sugRef.current.contains(e.target)) setShowSugg(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  const addProduct = (p) => {
    if (items.find(i => i.product_id === p.product_id)) { toast.warning('Already added'); return; }
    // Fetch stock info for this product
    api.get('/po/product-stock-info', { params: { product_id: p.product_id } }).then(r => {
      const info = r.data.products?.[0];
      setItems(prev => [...prev, {
        product_id: p.product_id, product_name: p.product_name,
        landing_cost: info?.landing_cost || p.landing_cost || 0, quantity: 1,
        store_stock: info?.store_stock || [], total_stock: info?.total_stock || 0,
      }]);
    }).catch(() => {
      setItems(prev => [...prev, { product_id: p.product_id, product_name: p.product_name, landing_cost: p.landing_cost || 0, quantity: 1, store_stock: [], total_stock: 0 }]);
    });
    setProductSearch(''); setShowSugg(false);
  };
  const updateQty = (idx, qty) => { const n = [...items]; n[idx].quantity = parseFloat(qty) || 0; setItems(n); };
  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx));
  const totalValue = items.reduce((s, i) => s + (i.quantity * i.landing_cost), 0);
  const needsCustomer = reason === 'emergency_purchase' || reason === 'customer_enquiry';

  const handleSubmit = async () => {
    if (!storeId || !reason || items.length === 0) { toast.error('Fill all required fields'); return; }
    if (needsCustomer && (!custName || !custMobile)) { toast.error('Customer details required'); return; }
    setSaving(true);
    try {
      const res = await api.post('/po/store-request', {
        store_id: parseInt(storeId), request_reason: reason,
        customer_name: needsCustomer ? custName : null, customer_mobile: needsCustomer ? custMobile : null,
        items: items.map(i => ({ product_id: i.product_id, product_name: i.product_name, quantity: i.quantity })),
      });
      toast.success(`Request submitted! Approx INR ${res.data.total_value.toLocaleString('en-IN')}`);
      setReason(''); setCustName(''); setCustMobile(''); setItems([]);
      loadRequests();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const reasonBadge = (r) => r === 'emergency_purchase' ? 'bg-red-50 text-red-700' : r === 'stock_refill' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700';
  const statusBadge = (s) => ({ po_created: 'bg-emerald-50 text-emerald-700', approved: 'bg-sky-50 text-sky-700', rejected: 'bg-red-50 text-red-700' }[s] || 'bg-amber-50 text-amber-700');

  return (
    <div data-testid="store-request-page" className="space-y-5">
      <div><h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Purchase Request</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">Request products from Head Office</p></div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold">New Request</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="font-body text-xs font-medium">1. Purchase Reason *</Label>
              <Select value={reason} onValueChange={setReason}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select reason" /></SelectTrigger>
                <SelectContent><SelectItem value="emergency_purchase">Emergency Purchase (Customer)</SelectItem><SelectItem value="stock_refill">Stock Refill</SelectItem><SelectItem value="customer_enquiry">Customer Enquiry</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
              <Select value={storeId} onValueChange={setStoreId} disabled={user?.role === 'STORE_STAFF'}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {reason && needsCustomer && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-amber-50/50 border border-amber-200 rounded-sm">
              <div className="space-y-1.5"><Label className="font-body text-xs">Customer Name *</Label><Input value={custName} onChange={e => setCustName(e.target.value)} className="rounded-sm" /></div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Mobile *</Label><Input value={custMobile} onChange={e => setCustMobile(e.target.value)} className="rounded-sm font-mono" maxLength={10} /></div>
            </div>
          )}
          {reason && (
            <div className="space-y-1.5" ref={sugRef}>
              <Label className="font-body text-xs font-medium">2. Add Products (qty in strips)</Label>
              <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Search product by name or ID..." value={productSearch} onChange={e => setProductSearch(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSugg(true)} className="rounded-sm pl-9" autoComplete="off" />
                {showSugg && suggestions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-[200px] overflow-auto">
                    {suggestions.map(p => (<button key={p.product_id} type="button" className="w-full text-left px-3 py-2 hover:bg-sky-50 border-b border-slate-50"
                      onClick={() => addProduct(p)}><p className="text-[13px] font-medium text-slate-800">{p.product_name}</p><p className="text-[10px] text-slate-400">{p.product_id} | L.Cost: {p.landing_cost}</p></button>))}
                  </div>)}
              </div>
            </div>
          )}
          {items.length > 0 && (<>
            <Card className="border-emerald-200 rounded-sm">
              <Table><TableHeader><TableRow className="border-b border-slate-100">
                {['Product', 'ID', 'Stock', 'Qty (Strips)', 'L.Cost', 'Value', ''].map(h => (
                  <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-2 ${['Qty (Strips)', 'L.Cost', 'Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow></TableHeader><TableBody>{items.map((it, i) => (
                <TableRow key={i}>
                  <TableCell className="text-[12px] font-medium text-slate-800 py-1.5">{it.product_name}</TableCell>
                  <TableCell className="font-mono text-[10px] text-slate-400">{it.product_id}</TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex gap-0.5 flex-wrap">{it.store_stock?.length > 0
                      ? it.store_stock.map((s, j) => <Badge key={j} variant="secondary" className="text-[8px] rounded-sm px-1">{s.store}: {s.stock}</Badge>)
                      : <span className="text-[10px] text-red-400">No stock</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-1.5"><Input type="number" min={1} value={it.quantity} onChange={e => updateQty(i, e.target.value)} className="w-[70px] h-7 text-right rounded-sm text-[12px] ml-auto" /></TableCell>
                  <TableCell className="text-right text-[11px] tabular-nums">{it.landing_cost.toFixed(2)}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {(it.quantity * it.landing_cost).toFixed(2)}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={() => removeItem(i)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                </TableRow>
              ))}</TableBody></Table>
              <div className="flex justify-between items-center px-4 py-2 bg-emerald-50 border-t border-emerald-100">
                <span className="text-[12px] font-body text-emerald-800">{items.length} items</span>
                <span className="text-lg font-heading font-bold text-emerald-700 tabular-nums">INR {totalValue.toFixed(2)}</span>
              </div>
            </Card>
            <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs w-full" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Submitting...' : `Submit Request (${items.length} items, INR ${totalValue.toFixed(2)})`}
            </Button>
          </>)}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold">My Requests</CardTitle></CardHeader>
        <div className="overflow-auto max-h-[250px]"><Table><TableHeader><TableRow className="border-b-2 border-slate-100">
          {['#', 'Store', 'Reason', 'Items', 'Value', 'Status', 'Date'].map(h => <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>)}
        </TableRow></TableHeader><TableBody>
          {requests.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-10"><ShoppingCart className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400">No requests</p></TableCell></TableRow>
          : requests.map(r => (
            <TableRow key={r.id} className="hover:bg-slate-50/50">
              <TableCell className="font-mono text-[11px]">#{r.id}</TableCell>
              <TableCell className="text-[12px]">{r.store_name}</TableCell>
              <TableCell><Badge className={`text-[9px] rounded-sm ${reasonBadge(r.request_reason)}`}>{r.request_reason?.replace('_', ' ')}</Badge></TableCell>
              <TableCell className="text-[12px] tabular-nums">{r.total_items}</TableCell>
              <TableCell className="text-[12px] tabular-nums font-medium">INR {r.total_value?.toLocaleString('en-IN')}</TableCell>
              <TableCell><Badge className={`text-[9px] rounded-sm ${statusBadge(r.status)}`}>{r.status}</Badge></TableCell>
              <TableCell className="text-[11px] text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody></Table></div>
      </Card>
    </div>
  );
}
