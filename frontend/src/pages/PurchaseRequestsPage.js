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
import { Textarea } from '../components/ui/textarea';
import { toast } from 'sonner';
import { ShoppingCart, Plus, AlertTriangle, Download, Search, Check, X, Truck, Phone, Clock } from 'lucide-react';
import { downloadExcel } from '../lib/api';

export default function PurchaseRequestsPage() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [stores, setStores] = useState([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('registered');
  const [form, setForm] = useState({ store_id: '', product_id: '', product_name: '', brand_name: '', quantity: '', customer_name: '', customer_contact: '', purchase_reason: 'customer_enquiry' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [actionDialog, setActionDialog] = useState(null);
  const [actionForm, setActionForm] = useState({ supplier: '', tat_days: '', remarks: '', fulfillment_status: '' });

  const isCRM = user?.role === 'CRM_STAFF';
  const isHO = user?.role === 'ADMIN' || user?.role === 'HO_STAFF' || user?.role === 'DIRECTOR';

  const loadPurchases = () => { api.get('/purchases').then(r => setPurchases(r.data.purchases)).catch(() => {}); };
  useEffect(() => { loadPurchases(); api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);
  useEffect(() => { if (user?.role === 'STORE_STAFF' && user?.store_id) setForm(f => ({ ...f, store_id: String(user.store_id) })); }, [user]);

  useEffect(() => {
    if (productSearch.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => { api.get('/products', { params: { search: productSearch, limit: 15 } }).then(r => { setSuggestions(r.data.products); setShowSuggestions(true); }).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);
  useEffect(() => {
    const h = (e) => { if (suggestRef.current && !suggestRef.current.contains(e.target)) setShowSuggestions(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setResult(null);
    try {
      const payload = { store_id: parseInt(form.store_id), product_name: form.product_name, quantity: parseFloat(form.quantity),
        customer_name: form.customer_name, customer_contact: form.customer_contact, purchase_reason: form.purchase_reason, is_registered_product: tab === 'registered' };
      if (tab === 'registered') payload.product_id = form.product_id; else payload.brand_name = form.brand_name;
      const res = await api.post('/purchases', payload); setResult(res.data);
      if (res.data.status === 'transfer_suggested') toast.warning('Stock available in network - transfer suggested'); else toast.success('Purchase request created');
      loadPurchases();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };

  // CRM Actions
  const handleCRMVerify = async (id) => { try { await api.put(`/purchases/${id}/crm-verify`); toast.success('Verified by CRM'); loadPurchases(); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }};
  const handleCRMReject = async (id) => { try { await api.put(`/purchases/${id}/crm-reject`); toast.success('Rejected by CRM'); loadPurchases(); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }};
  const handleCRMRemarks = async (id, remarks) => { try { await api.put(`/purchases/${id}/crm-remarks`, { remarks }); toast.success('Remarks saved'); loadPurchases(); setActionDialog(null); } catch (e) { toast.error('Failed'); }};

  // HO Actions
  const handleHOApprove = async () => {
    if (!actionDialog) return;
    try { await api.put(`/purchases/${actionDialog.id}/ho-approve`, { supplier: actionForm.supplier, tat_days: parseInt(actionForm.tat_days) || 0, ho_remarks: actionForm.remarks });
      toast.success('Approved by HO with supplier assigned'); loadPurchases(); setActionDialog(null); setActionForm({ supplier: '', tat_days: '', remarks: '', fulfillment_status: '' });
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };
  const handleFulfillment = async (id, status) => { try { await api.put(`/purchases/${id}/fulfillment`, { fulfillment_status: status }); toast.success(`Updated: ${status}`); loadPurchases(); } catch (e) { toast.error('Failed'); }};

  const filtered = statusFilter === 'all' ? purchases : purchases.filter(p => {
    if (statusFilter === 'crm_pending') return (p.crm_status || 'pending') === 'pending' && p.status !== 'rejected';
    if (statusFilter === 'crm_verified') return p.crm_status === 'verified';
    if (statusFilter === 'ho_pending') return p.crm_status === 'verified' && (p.ho_status || 'pending') === 'pending';
    if (statusFilter === 'ho_approved') return p.ho_status === 'approved';
    if (statusFilter === 'fulfilled') return p.fulfillment_status === 'delivered';
    return true;
  });

  const reasonBadge = (r) => r === 'emergency_purchase' ? 'bg-red-50 text-red-700' : r === 'stock_refill' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600';
  const crmBadge = (s) => s === 'verified' ? 'bg-emerald-50 text-emerald-700' : s === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700';
  const hoBadge = (s) => s === 'approved' ? 'bg-sky-50 text-sky-700' : s === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500';
  const fulfillBadge = (s) => s === 'delivered' ? 'bg-emerald-50 text-emerald-700' : s === 'dispatched' ? 'bg-sky-50 text-sky-700' : s === 'ordered' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-400';

  return (
    <div data-testid="purchases-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Purchase Requests</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Multi-stage: Store Request → CRM Verify → HO Approve → Fulfill</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResult(null); }}>
            <DialogTrigger asChild><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" data-testid="create-purchase-btn"><Plus className="w-3.5 h-3.5 mr-1.5" /> New Request</Button></DialogTrigger>
            <Button variant="outline" className="rounded-sm font-body text-xs" data-testid="export-purchases-btn"
              onClick={() => downloadExcel('/export/purchases', 'purchases.xlsx').catch(() => toast.error('Export failed'))}><Download className="w-3.5 h-3.5 mr-1.5" /> Export</Button>
            <DialogContent className="rounded-sm max-w-lg">
              <DialogHeader><DialogTitle className="font-heading">Create Purchase Request</DialogTitle></DialogHeader>
              <Tabs value={tab} onValueChange={v => { setTab(v); setResult(null); }}>
                <TabsList className="grid w-full grid-cols-2 rounded-sm">
                  <TabsTrigger value="registered" className="rounded-sm text-xs font-body">Registered</TabsTrigger>
                  <TabsTrigger value="non-registered" className="rounded-sm text-xs font-body">Non-Registered</TabsTrigger>
                </TabsList>
                <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                  <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
                    <Select value={form.store_id} onValueChange={v => setForm({...form, store_id: v})} disabled={user?.role === 'STORE_STAFF'}>
                      <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select store" /></SelectTrigger>
                      <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <TabsContent value="registered" className="mt-0 space-y-3">
                    <div className="space-y-1.5" ref={suggestRef}>
                      <Label className="font-body text-xs">Product * <span className="text-slate-400 font-normal">(type to search)</span></Label>
                      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <Input data-testid="purchase-product-search" placeholder="Search product name or ID..." value={productSearch}
                          onChange={e => { setProductSearch(e.target.value); if (!e.target.value) setForm({...form, product_id: '', product_name: ''}); }}
                          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)} className="rounded-sm pl-9 font-body" autoComplete="off" />
                        {showSuggestions && suggestions.length > 0 && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-[200px] overflow-auto">
                            {suggestions.map(p => (<button key={p.product_id} type="button" className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
                              onClick={() => { setForm({...form, product_id: p.product_id, product_name: p.product_name}); setProductSearch(p.product_name); setShowSuggestions(false); }}>
                              <p className="text-[13px] font-body font-medium text-slate-800">{p.product_name}</p>
                              <p className="text-[10px] font-mono text-slate-400">{p.product_id} | MRP: {p.mrp} | {p.category || ''}</p>
                            </button>))}
                          </div>)}
                      </div>
                      {form.product_id && <p className="text-[10px] font-body text-emerald-600">Selected: {form.product_name} ({form.product_id})</p>}
                    </div>
                  </TabsContent>
                  <TabsContent value="non-registered" className="mt-0 space-y-3">
                    <div className="space-y-1.5"><Label className="font-body text-xs">Product Name *</Label><Input value={form.product_name} onChange={e => setForm({...form, product_name: e.target.value})} className="rounded-sm" /></div>
                    <div className="space-y-1.5"><Label className="font-body text-xs">Brand</Label><Input value={form.brand_name} onChange={e => setForm({...form, brand_name: e.target.value})} className="rounded-sm" /></div>
                  </TabsContent>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Purchase Reason *</Label>
                    <Select value={form.purchase_reason} onValueChange={v => setForm({...form, purchase_reason: v})}>
                      <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="customer_enquiry">Customer Enquiry</SelectItem><SelectItem value="stock_refill">Stock Refill</SelectItem><SelectItem value="emergency_purchase">Emergency Purchase</SelectItem></SelectContent>
                    </Select></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5"><Label className="font-body text-xs">Quantity *</Label><Input type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required className="rounded-sm" /></div>
                    <div className="space-y-1.5"><Label className="font-body text-xs">Customer *</Label><Input value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} required className="rounded-sm" /></div>
                    <div className="space-y-1.5"><Label className="font-body text-xs">Contact *</Label><Input value={form.customer_contact} onChange={e => setForm({...form, customer_contact: e.target.value})} required className="rounded-sm" /></div>
                  </div>
                  {result && result.status === 'transfer_suggested' && result.network_stock_info && (
                    <Card className="border-amber-200 bg-amber-50/50 rounded-sm"><CardContent className="p-3"><div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" /><div><p className="text-xs font-body font-medium text-amber-800">Stock in network!</p>
                      <p className="text-[11px] font-body text-amber-700 mt-1">HO: {result.network_stock_info.ho_stock} {result.network_stock_info.store_stock && Object.entries(result.network_stock_info.store_stock).map(([s,q]) => <span key={s}> | {s}: {q}</span>)}</p>
                    </div></div></CardContent></Card>)}
                  <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>{saving ? 'Creating...' : 'Submit Request'}</Button></DialogFooter>
                </form>
              </Tabs>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stage Filters */}
      <div className="flex gap-1.5 flex-wrap">
        {[{ v: 'all', l: 'All' }, { v: 'crm_pending', l: 'CRM Pending' }, { v: 'crm_verified', l: 'CRM Verified' },
          { v: 'ho_pending', l: 'HO Pending' }, { v: 'ho_approved', l: 'HO Approved' }, { v: 'fulfilled', l: 'Delivered' }].map(f => (
          <Button key={f.v} variant={statusFilter === f.v ? 'default' : 'outline'} size="sm"
            className={`rounded-sm font-body text-xs ${statusFilter === f.v ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
            onClick={() => setStatusFilter(f.v)} data-testid={`pf-${f.v}`}>{f.l}</Button>
        ))}
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-300px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['ID', 'Store', 'Product', 'Qty', 'Reason', 'Customer', 'CRM', 'HO', 'Supplier', 'TAT', 'Fulfillment', 'Actions'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center py-16"><ShoppingCart className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No purchase requests</p></TableCell></TableRow>
              ) : filtered.map(p => (
                <TableRow key={p.id} className="hover:bg-slate-50/50" data-testid={`purchase-row-${p.id}`}>
                  <TableCell className="font-mono text-[11px] text-slate-500">#{p.id}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-600">{p.store_name}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 max-w-[150px] truncate">{p.product_name}</TableCell>
                  <TableCell className="text-[12px] tabular-nums">{p.quantity}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${reasonBadge(p.purchase_reason)}`}>{(p.purchase_reason || 'enquiry').replace('_', ' ')}</Badge></TableCell>
                  <TableCell><div><p className="text-[11px] text-slate-700">{p.customer_name}</p><p className="text-[10px] text-slate-400">{p.customer_contact}</p></div></TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${crmBadge(p.crm_status)}`}>{p.crm_status || 'pending'}</Badge></TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${hoBadge(p.ho_status)}`}>{p.ho_status || 'pending'}</Badge></TableCell>
                  <TableCell className="text-[11px] text-sky-700 font-medium">{p.assigned_supplier || '-'}</TableCell>
                  <TableCell className="text-[11px] tabular-nums">{p.tat_days ? `${p.tat_days}d` : '-'}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${fulfillBadge(p.fulfillment_status)}`}>{(p.fulfillment_status || 'not started').replace('_', ' ')}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {/* CRM Actions */}
                      {(isCRM || isHO) && (p.crm_status || 'pending') === 'pending' && p.status !== 'rejected' && (
                        <>
                          <Button size="sm" variant="outline" className="h-5 px-1.5 rounded-sm text-[9px] text-emerald-600 hover:bg-emerald-50"
                            onClick={() => handleCRMVerify(p.id)} data-testid={`crm-verify-${p.id}`}><Check className="w-2.5 h-2.5 mr-0.5" />Verify</Button>
                          <Button size="sm" variant="outline" className="h-5 px-1.5 rounded-sm text-[9px] text-red-600 hover:bg-red-50"
                            onClick={() => handleCRMReject(p.id)} data-testid={`crm-reject-${p.id}`}><X className="w-2.5 h-2.5" /></Button>
                          <Button size="sm" variant="outline" className="h-5 px-1.5 rounded-sm text-[9px]"
                            onClick={() => { setActionDialog({ ...p, action: 'crm_remark' }); setActionForm({ ...actionForm, remarks: p.crm_remarks || '' }); }}><Phone className="w-2.5 h-2.5 mr-0.5" />Remark</Button>
                        </>
                      )}
                      {/* HO Actions */}
                      {isHO && p.crm_status === 'verified' && (p.ho_status || 'pending') === 'pending' && (
                        <Button size="sm" variant="outline" className="h-5 px-1.5 rounded-sm text-[9px] text-sky-600 hover:bg-sky-50"
                          onClick={() => { setActionDialog({ ...p, action: 'ho_approve' }); setActionForm({ supplier: '', tat_days: '', remarks: '', fulfillment_status: '' }); }}
                          data-testid={`ho-approve-${p.id}`}><Truck className="w-2.5 h-2.5 mr-0.5" />Approve</Button>
                      )}
                      {/* Fulfillment Actions */}
                      {isHO && p.ho_status === 'approved' && p.fulfillment_status !== 'delivered' && (
                        <Select value="" onValueChange={v => handleFulfillment(p.id, v)}>
                          <SelectTrigger className="h-5 w-[70px] text-[9px] rounded-sm px-1"><SelectValue placeholder="Status" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ordered">Ordered</SelectItem>
                            <SelectItem value="dispatched">Dispatched</SelectItem>
                            <SelectItem value="delivered">Delivered</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Action Dialogs */}
      <Dialog open={!!actionDialog} onOpenChange={v => { if (!v) setActionDialog(null); }}>
        <DialogContent className="rounded-sm max-w-md">
          {actionDialog?.action === 'crm_remark' && (<>
            <DialogHeader><DialogTitle className="font-heading">CRM Remarks - #{actionDialog.id}</DialogTitle></DialogHeader>
            <p className="text-sm font-body text-slate-600">{actionDialog.product_name} | {actionDialog.customer_name} ({actionDialog.customer_contact})</p>
            <div className="space-y-2"><Label className="font-body text-xs">Remarks after customer call</Label>
              <Textarea value={actionForm.remarks} onChange={e => setActionForm({...actionForm, remarks: e.target.value})} className="rounded-sm" rows={3} placeholder="Customer confirmed / will visit / medicine changed..." /></div>
            <DialogFooter><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={() => handleCRMRemarks(actionDialog.id, actionForm.remarks)}>Save Remarks</Button></DialogFooter>
          </>)}
          {actionDialog?.action === 'ho_approve' && (<>
            <DialogHeader><DialogTitle className="font-heading">HO Approve - #{actionDialog.id}</DialogTitle></DialogHeader>
            <p className="text-sm font-body text-slate-600">{actionDialog.product_name} | Qty: {actionDialog.quantity} | Store: {actionDialog.store_name}</p>
            {actionDialog.crm_remarks && <p className="text-[11px] font-body text-violet-700 bg-violet-50 p-2 rounded-sm">CRM: {actionDialog.crm_remarks}</p>}
            <div className="space-y-3">
              <div className="space-y-1.5"><Label className="font-body text-xs">Assign Supplier *</Label>
                <Input value={actionForm.supplier} onChange={e => setActionForm({...actionForm, supplier: e.target.value})} className="rounded-sm" placeholder="Supplier name" data-testid="ho-supplier-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="font-body text-xs">TAT (days)</Label>
                  <Input type="number" value={actionForm.tat_days} onChange={e => setActionForm({...actionForm, tat_days: e.target.value})} className="rounded-sm" placeholder="e.g. 3" data-testid="ho-tat-input" /></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Expected Delivery</Label>
                  <p className="text-sm font-body text-slate-600 mt-1">{actionForm.tat_days ? new Date(Date.now() + parseInt(actionForm.tat_days) * 86400000).toLocaleDateString() : '-'}</p></div>
              </div>
              <div className="space-y-1.5"><Label className="font-body text-xs">HO Remarks</Label>
                <Textarea value={actionForm.remarks} onChange={e => setActionForm({...actionForm, remarks: e.target.value})} className="rounded-sm" rows={2} /></div>
            </div>
            <DialogFooter><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={handleHOApprove} disabled={!actionForm.supplier} data-testid="ho-approve-submit">Approve & Assign Supplier</Button></DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
