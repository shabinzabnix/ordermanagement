import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { ShoppingCart, Search, Trash2, Plus, Package } from 'lucide-react';

export default function StoreRequestPage() {
  const { user } = useAuth();
  const isHO = user?.role === 'ADMIN' || user?.role === 'HO_STAFF';
  const [stores, setStores] = useState([]);
  const [requests, setRequests] = useState([]);
  // New request form
  const [reason, setReason] = useState('');
  const [storeId, setStoreId] = useState('');
  const [custName, setCustName] = useState('');
  const [custMobile, setCustMobile] = useState('');
  const [items, setItems] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [manualCost, setManualCost] = useState('');
  const [hasPrescription, setHasPrescription] = useState(false);
  const [doctorName, setDoctorName] = useState('');
  const [clinicLocation, setClinicLocation] = useState('');
  const [saving, setSaving] = useState(false);
  // HO review
  const [allItems, setAllItems] = useState([]);
  const [reviewFilter, setReviewFilter] = useState('all');
  const sugRef = useRef(null);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); loadData(); }, []);
  useEffect(() => { if (user?.role === 'STORE_STAFF' && user?.store_id) setStoreId(String(user.store_id)); }, [user]);

  const loadData = () => {
    api.get('/po/store-requests').then(r => setRequests(r.data.requests)).catch(() => {});
    api.get('/po/purchase-review?po_category=all').then(r => setAllItems(r.data.items)).catch(() => {});
  };

  useEffect(() => {
    if (productSearch.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => { api.get('/products', { params: { search: productSearch, limit: 15 } }).then(r => { setSuggestions(r.data.products); setShowSugg(true); }).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);
  useEffect(() => { const h = (e) => { if (sugRef.current && !sugRef.current.contains(e.target)) setShowSugg(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  const addProduct = (p) => {
    if (items.find(i => i.product_id === p.product_id)) { toast.warning('Already added'); return; }
    api.get('/po/product-stock-info', { params: { product_id: p.product_id } }).then(r => {
      const info = r.data.products?.[0];
      setItems(prev => [...prev, { product_id: p.product_id, product_name: p.product_name, is_registered: true,
        landing_cost: info?.landing_cost || p.landing_cost || 0, quantity: 1, store_stock: info?.store_stock || [], has_prescription: false }]);
    }).catch(() => { setItems(prev => [...prev, { product_id: p.product_id, product_name: p.product_name, is_registered: true, landing_cost: p.landing_cost || 0, quantity: 1, store_stock: [], has_prescription: false }]); });
    setProductSearch(''); setShowSugg(false);
  };
  const addManualProduct = () => {
    if (!manualName) return;
    setItems([...items, { product_id: null, product_name: manualName, is_registered: false, landing_cost: parseFloat(manualCost) || 0, quantity: parseFloat(manualQty) || 1, store_stock: [],
      has_prescription: hasPrescription, doctor_name: hasPrescription ? doctorName : null, clinic_location: hasPrescription ? clinicLocation : null }]);
    setManualName(''); setManualQty(''); setManualCost(''); setHasPrescription(false); setDoctorName(''); setClinicLocation('');
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
      await api.post('/po/store-request', {
        store_id: parseInt(storeId), request_reason: reason,
        customer_name: needsCustomer ? custName : null, customer_mobile: needsCustomer ? custMobile : null,
        items: items.map(i => ({ product_id: i.product_id, product_name: i.product_name, is_registered: i.is_registered,
          quantity: i.quantity, has_prescription: i.has_prescription || false,
          doctor_name: i.doctor_name || null, clinic_location: i.clinic_location || null })),
      });
      toast.success('Request submitted!');
      setReason(''); setCustName(''); setCustMobile(''); setItems([]);
      loadData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const updateItem = async (id, supplier, status, tat) => {
    const payload = { item_ids: [id] };
    if (supplier) payload.supplier = supplier;
    if (status) payload.status = status;
    if (tat) payload.tat_days = tat;
    try { await api.put('/po/purchase-review/update', payload); loadData(); } catch { toast.error('Failed'); }
  };

  const reasonBadge = (r) => r === 'emergency_purchase' ? 'bg-red-50 text-red-700' : r === 'stock_refill' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700';
  const sBadge = (s) => ({ approved: 'bg-emerald-50 text-emerald-700', ordered: 'bg-sky-50 text-sky-700', rejected: 'bg-red-50 text-red-700' }[s] || 'bg-amber-50 text-amber-700');

  const filteredItems = reviewFilter === 'all' ? allItems : allItems.filter(i =>
    i.item_status === reviewFilter || i.fulfillment_status === reviewFilter
  );
  // Non-categorized items (no po_category) for normal requests view
  const normalRequests = requests;

  return (
    <div data-testid="store-request-page" className="space-y-5">
      <div><h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Store Requests</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">{isHO ? 'Review and manage all store requests' : 'Request products from Head Office'}</p></div>

      <Tabs defaultValue={isHO ? "requests" : "new"}>
        <TabsList className="rounded-sm">
          <TabsTrigger value="new" className="rounded-sm text-xs font-body">New Request</TabsTrigger>
          <TabsTrigger value="requests" className="rounded-sm text-xs font-body">Requests ({allItems.length})</TabsTrigger>
        </TabsList>

        {/* Requests - Individual Products */}
        <TabsContent value="requests">
          <div className="flex gap-1.5 mb-3">
            {['all', 'pending', 'approved', 'rejected', 'order_placed', 'dispatched', 'received'].map(s => (
              <Button key={s} variant={reviewFilter === s ? 'default' : 'outline'} size="sm"
                className={`rounded-sm font-body text-xs capitalize ${reviewFilter === s ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
                onClick={() => setReviewFilter(s)}>{s.replace('_', ' ')}</Button>
            ))}
          </div>
            <div className="space-y-2">
              {filteredItems.length === 0 ? (
                <Card className="border-slate-200 rounded-sm"><CardContent className="p-12 text-center"><Package className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No items</p></CardContent></Card>
              ) : filteredItems.map(it => (
                <Card key={it.id} className={`border-slate-200 shadow-sm rounded-sm ${it.item_status === 'approved' ? 'border-l-4 border-l-emerald-400' : it.item_status === 'ordered' ? 'border-l-4 border-l-sky-400' : it.item_status === 'rejected' ? 'border-l-4 border-l-red-400' : ''}`}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-heading font-bold text-slate-900">{it.product_name}</span>
                        {it.po_category && <Badge className={`text-[8px] rounded-sm ${{
                          'BRAND-RX':'bg-blue-50 text-blue-700','GEN-RX':'bg-violet-50 text-violet-700','OTC':'bg-emerald-50 text-emerald-700','OTX':'bg-amber-50 text-amber-700',
                        }[it.po_category]||'bg-slate-100'}`}>{it.po_category}</Badge>}
                        <span className="font-mono text-[10px] text-slate-400">{it.product_id}</span>
                        {it.product_info?.sub_category && <Badge variant="secondary" className="text-[8px] rounded-sm">{it.product_info.sub_category}</Badge>}
                      </div>
                      <Badge className={`text-[9px] rounded-sm ${sBadge(it.item_status)}`}>{it.item_status}</Badge>
                    </div>
                    <div className="flex gap-4 text-[11px] font-body text-slate-500 flex-wrap">
                      <span>Store: <b className="text-slate-700">{it.store_name}</b></span>
                      <span>Qty: <b className="text-slate-700">{it.quantity}</b></span>
                      <span>L.Cost: <b className="text-slate-700">{it.landing_cost?.toFixed(2)}</b></span>
                      <span>Value: <b className="text-slate-700">INR {(it.quantity*(it.landing_cost||0)).toFixed(2)}</b></span>
                      <span>Sales 30d: <b className="text-slate-700">{it.sales_30d}</b></span>
                      {it.customer_name && <span>Customer: <b className="text-slate-700">{it.customer_name} ({it.customer_mobile})</b></span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-400">Stock:</span>
                      {it.store_stock?.length > 0 ? it.store_stock.map((s,j) => <Badge key={j} variant="secondary" className="text-[8px] rounded-sm px-1">{s.store}: {s.stock}</Badge>) : <span className="text-[10px] text-red-500">No stock</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-400">Suppliers:</span>
                      {Object.entries(it.suppliers||{}).map(([type,name]) => name && (
                        <Button key={type} variant="outline" size="sm" className={`h-5 px-2 rounded-sm text-[9px] ${it.selected_supplier===name?'bg-emerald-50 text-emerald-700 border-emerald-300':''}`}
                          onClick={() => updateItem(it.id, name)}>{name} <span className="text-slate-400 ml-1">({type})</span></Button>
                      ))}
                      {it.selected_supplier && <Badge className="text-[9px] rounded-sm bg-emerald-100 text-emerald-800">Assigned: {it.selected_supplier}</Badge>}
                    </div>
                    <div className="flex items-center gap-3 pt-1 border-t border-slate-100">
                      <Select value="" onValueChange={v => updateItem(it.id, null, v)}>
                        <SelectTrigger className="w-[100px] h-6 text-[10px] rounded-sm"><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent><SelectItem value="approved">Approve</SelectItem><SelectItem value="ordered">Ordered</SelectItem><SelectItem value="rejected">Reject</SelectItem></SelectContent>
                      </Select>
                      <div className="flex items-center gap-1"><span className="text-[10px] text-slate-400">TAT:</span>
                        <Input type="number" placeholder="days" className="w-[50px] h-6 text-[10px] rounded-sm text-center"
                          defaultValue={it.tat_days||''} onBlur={e => {const v=parseInt(e.target.value);if(v>0)updateItem(it.id,null,null,v);}} /></div>
                      {it.tat_days && <span className="text-[10px] text-sky-600">TAT: {it.tat_days}d</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
        </TabsContent>

        {/* New Request Form */}
        <TabsContent value="new">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="font-body text-xs font-medium">1. Reason *</Label>
                  <Select value={reason} onValueChange={setReason}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent><SelectItem value="emergency_purchase">Emergency Purchase</SelectItem><SelectItem value="stock_refill">Stock Refill</SelectItem><SelectItem value="customer_enquiry">Customer Enquiry</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
                  <Select value={storeId} onValueChange={setStoreId} disabled={user?.role==='STORE_STAFF'}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{stores.map(s=><SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent></Select></div>
              </div>
              {reason && needsCustomer && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-amber-50/50 border border-amber-200 rounded-sm">
                  <div className="space-y-1.5"><Label className="font-body text-xs">Customer *</Label><Input value={custName} onChange={e=>setCustName(e.target.value)} className="rounded-sm" /></div>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Mobile *</Label><Input value={custMobile} onChange={e=>setCustMobile(e.target.value)} className="rounded-sm font-mono" maxLength={10} /></div>
                </div>
              )}
              {reason && (<>
                <div className="space-y-1.5" ref={sugRef}><Label className="font-body text-xs font-medium">2. Add Products</Label>
                  <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <Input placeholder="Search product..." value={productSearch} onChange={e=>setProductSearch(e.target.value)} onFocus={()=>suggestions.length>0&&setShowSugg(true)} className="rounded-sm pl-9" autoComplete="off" />
                    {showSugg && suggestions.length>0 && (<div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-[200px] overflow-auto">
                      {suggestions.map(p=>(<button key={p.product_id} type="button" className="w-full text-left px-3 py-2 hover:bg-sky-50 border-b border-slate-50" onClick={()=>addProduct(p)}>
                        <p className="text-[13px] font-medium">{p.product_name}</p><p className="text-[10px] text-slate-400">{p.product_id} | L.Cost: {p.landing_cost}</p></button>))}</div>)}</div></div>
                <div className="flex gap-2 items-end">
                  <Input placeholder="Non-reg product" value={manualName} onChange={e=>setManualName(e.target.value)} className="flex-1 rounded-sm text-sm" />
                  <Input placeholder="Qty" type="number" value={manualQty} onChange={e=>setManualQty(e.target.value)} className="w-[60px] rounded-sm text-sm" />
                  <Input placeholder="Cost" type="number" value={manualCost} onChange={e=>setManualCost(e.target.value)} className="w-[70px] rounded-sm text-sm" />
                  <Button variant="outline" size="sm" className="rounded-sm text-xs" onClick={addManualProduct} disabled={!manualName}><Plus className="w-3 h-3" /></Button>
                </div>
              </>)}
              {items.length>0 && (<>
                <Card className="border-emerald-200 rounded-sm"><Table><TableBody>{items.map((it,i)=>(
                  <TableRow key={i}><TableCell className="text-[12px] font-medium py-1.5">{it.product_name}</TableCell>
                    <TableCell className="py-1"><div className="flex gap-0.5 flex-wrap">{it.store_stock?.length>0?it.store_stock.map((s,j)=><Badge key={j} variant="secondary" className="text-[7px] rounded-sm px-1">{s.store}:{s.stock}</Badge>):<span className="text-[9px] text-slate-400">{it.is_registered?'No stock':'-'}</span>}</div></TableCell>
                    <TableCell className="text-right py-1.5"><Input type="number" min={1} value={it.quantity} onChange={e=>updateQty(i,e.target.value)} className="w-[60px] h-7 text-right rounded-sm text-[12px] ml-auto" /></TableCell>
                    <TableCell className="text-right text-[11px] tabular-nums">{it.landing_cost.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {(it.quantity*it.landing_cost).toFixed(2)}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={()=>removeItem(i)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                  </TableRow>))}</TableBody></Table>
                  <div className="flex justify-between items-center px-4 py-2 bg-emerald-50 border-t border-emerald-100">
                    <span className="text-[12px] text-emerald-800">{items.length} items</span>
                    <span className="text-lg font-heading font-bold text-emerald-700 tabular-nums">INR {totalValue.toFixed(2)}</span>
                  </div></Card>
                <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs w-full" onClick={handleSubmit} disabled={saving}>
                  {saving?'Submitting...':`Submit (${items.length} items, INR ${totalValue.toFixed(2)})`}</Button>
              </>)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
