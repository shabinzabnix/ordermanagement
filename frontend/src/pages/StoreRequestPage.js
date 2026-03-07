import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { toast } from 'sonner';
import { ShoppingCart, Search, Trash2, Package } from 'lucide-react';

export default function StoreRequestPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [requests, setRequests] = useState([]);
  // Form state
  const [reason, setReason] = useState('');
  const [storeId, setStoreId] = useState('');
  const [custName, setCustName] = useState('');
  const [custMobile, setCustMobile] = useState('');
  const [selectedSubCat, setSelectedSubCat] = useState('');
  const [subcatProducts, setSubcatProducts] = useState([]);
  const [subcatSuppliers, setSubcatSuppliers] = useState([]);
  const [items, setItems] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {});
    api.get('/products/sub-categories').then(r => setSubCategories(r.data.sub_categories || [])).catch(() => {});
    loadRequests();
  }, []);
  useEffect(() => { if (user?.role === 'STORE_STAFF' && user?.store_id) setStoreId(String(user.store_id)); }, [user]);

  // Load products + suppliers when sub-category changes
  useEffect(() => {
    if (!selectedSubCat) { setSubcatProducts([]); setSubcatSuppliers([]); return; }
    api.get('/po/subcategory-data', { params: { sub_category: selectedSubCat } })
      .then(r => { setSubcatProducts(r.data.products); setSubcatSuppliers(r.data.suppliers); })
      .catch(() => {});
  }, [selectedSubCat]);

  const loadRequests = () => { api.get('/po/store-requests').then(r => setRequests(r.data.requests)).catch(() => {}); };

  const filteredProducts = productSearch
    ? subcatProducts.filter(p => p.product_name.toLowerCase().includes(productSearch.toLowerCase()) || p.product_id?.includes(productSearch))
    : subcatProducts;

  const addProduct = (p) => {
    if (items.find(i => i.product_id === p.product_id)) { toast.warning('Already added'); return; }
    setItems([...items, { product_id: p.product_id, product_name: p.product_name, landing_cost: p.landing_cost || 0, quantity: 1 }]);
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
      setReason(''); setCustName(''); setCustMobile(''); setItems([]); setSelectedSubCat(''); setProductSearch('');
      loadRequests();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const reasonBadge = (r) => r === 'emergency_purchase' ? 'bg-red-50 text-red-700' : r === 'stock_refill' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700';
  const statusBadge = (s) => s === 'po_created' ? 'bg-emerald-50 text-emerald-700' : s === 'approved' ? 'bg-sky-50 text-sky-700' : s === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700';

  return (
    <div data-testid="store-request-page" className="space-y-5">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Purchase Request</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">Create purchase requests by sub-category</p>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold">New Request</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Row 1: Reason + Store */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-body text-xs font-medium">1. Purchase Reason *</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select reason" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="emergency_purchase">Emergency Purchase (Customer)</SelectItem>
                  <SelectItem value="stock_refill">Stock Refill</SelectItem>
                  <SelectItem value="customer_enquiry">Customer Enquiry</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="font-body text-xs">Store *</Label>
              <Select value={storeId} onValueChange={setStoreId} disabled={user?.role === 'STORE_STAFF'}>
                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* Customer Info */}
          {reason && needsCustomer && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-amber-50/50 border border-amber-200 rounded-sm">
              <div className="space-y-1.5"><Label className="font-body text-xs">Customer Name *</Label>
                <Input value={custName} onChange={e => setCustName(e.target.value)} className="rounded-sm" /></div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Mobile Number *</Label>
                <Input value={custMobile} onChange={e => setCustMobile(e.target.value)} className="rounded-sm font-mono" maxLength={10} /></div>
            </div>
          )}

          {/* Row 2: Sub Category */}
          {reason && (
            <div className="space-y-1.5">
              <Label className="font-body text-xs font-medium">2. Select Sub Category *</Label>
              <Select value={selectedSubCat} onValueChange={v => { setSelectedSubCat(v); setItems([]); setProductSearch(''); }}>
                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select sub category" /></SelectTrigger>
                <SelectContent className="max-h-[250px]">
                  {subCategories.map(sc => <SelectItem key={sc} value={sc}>{sc}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Suppliers for this sub-category */}
          {selectedSubCat && subcatSuppliers.length > 0 && (
            <div className="p-3 bg-sky-50/50 border border-sky-200 rounded-sm">
              <p className="text-[10px] font-body text-sky-600 uppercase tracking-wider mb-1.5">Suppliers for {selectedSubCat}</p>
              <div className="flex gap-1.5 flex-wrap">
                {subcatSuppliers.map(s => <Badge key={s} variant="secondary" className="text-[10px] rounded-sm">{s}</Badge>)}
              </div>
            </div>
          )}

          {/* Row 3: Products from sub-category */}
          {selectedSubCat && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-body text-xs font-medium">3. Select Products ({subcatProducts.length} in {selectedSubCat}) — Qty in Strips</Label>
                <div className="relative w-[250px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input placeholder="Filter products..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="rounded-sm pl-9 text-sm h-8" /></div>
              </div>
              <Card className="border-slate-200 rounded-sm">
                <div className="max-h-[250px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white z-10">
                      <TableRow className="border-b border-slate-100">
                        {['', 'Product', 'ID', 'Supplier', 'L.Cost', 'MRP'].map(h => (
                          <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-2 ${['L.Cost', 'MRP'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-[11px] text-slate-400">No products</TableCell></TableRow>
                      ) : filteredProducts.map(p => {
                        const added = items.some(i => i.product_id === p.product_id);
                        return (
                          <TableRow key={p.product_id} className={`hover:bg-sky-50/50 cursor-pointer ${added ? 'bg-emerald-50/30' : ''}`} onClick={() => !added && addProduct(p)}>
                            <TableCell className="w-[30px] py-1.5"><Checkbox checked={added} className="rounded-sm" /></TableCell>
                            <TableCell className="text-[12px] font-medium text-slate-800 py-1.5">{p.product_name}</TableCell>
                            <TableCell className="font-mono text-[10px] text-slate-400">{p.product_id}</TableCell>
                            <TableCell className="text-[10px] text-slate-500">{p.primary_supplier || '-'}</TableCell>
                            <TableCell className="text-right text-[11px] tabular-nums">{p.landing_cost.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-[11px] tabular-nums">{p.mrp.toFixed(2)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          )}

          {/* Selected items with qty */}
          {items.length > 0 && (
            <Card className="border-emerald-200 rounded-sm">
              <CardHeader className="py-2 px-4"><CardTitle className="text-xs font-heading font-semibold text-emerald-800">Selected Products ({items.length})</CardTitle></CardHeader>
              <Table>
                <TableBody>
                  {items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-[12px] font-medium text-slate-800 py-1.5">{it.product_name}</TableCell>
                      <TableCell className="font-mono text-[10px] text-slate-400">{it.product_id}</TableCell>
                      <TableCell className="text-right py-1.5">
                        <Input type="number" min={1} value={it.quantity} onChange={e => updateQty(i, e.target.value)} className="w-[70px] h-7 text-right rounded-sm text-[12px] ml-auto" />
                      </TableCell>
                      <TableCell className="text-right text-[11px] tabular-nums">{it.landing_cost.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {(it.quantity * it.landing_cost).toFixed(2)}</TableCell>
                      <TableCell className="py-1.5"><Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={() => removeItem(i)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-between items-center px-4 py-2 bg-emerald-50 border-t border-emerald-100">
                <span className="text-[12px] font-body text-emerald-800">{items.length} items | Qty: {items.reduce((s, i) => s + i.quantity, 0)} strips</span>
                <span className="text-lg font-heading font-bold text-emerald-700 tabular-nums">INR {totalValue.toFixed(2)}</span>
              </div>
            </Card>
          )}

          {items.length > 0 && (
            <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs w-full" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Submitting...' : `Submit Request (${items.length} items, INR ${totalValue.toFixed(2)})`}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Existing Requests */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold">My Requests</CardTitle></CardHeader>
        <div className="overflow-auto max-h-[300px]">
          <Table>
            <TableHeader><TableRow className="border-b-2 border-slate-100">
              {['#', 'Store', 'Reason', 'Items', 'Value', 'Status', 'Date'].map(h => (
                <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
              ))}
            </TableRow></TableHeader>
            <TableBody>
              {requests.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10"><ShoppingCart className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400">No requests</p></TableCell></TableRow>
              ) : requests.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50/50">
                  <TableCell className="font-mono text-[11px] text-slate-500">#{r.id}</TableCell>
                  <TableCell className="text-[12px]">{r.store_name}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${reasonBadge(r.request_reason)}`}>{r.request_reason?.replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-[12px] tabular-nums">{r.total_items}</TableCell>
                  <TableCell className="text-[12px] tabular-nums font-medium">INR {r.total_value?.toLocaleString('en-IN')}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${statusBadge(r.status)}`}>{r.status}</Badge></TableCell>
                  <TableCell className="text-[11px] text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
