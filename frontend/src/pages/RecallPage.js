import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { toast } from 'sonner';
import { RotateCcw, Plus, Upload, Search, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { UploadProgress } from '../components/UploadProgress';
import { ChatButton } from '../components/ChatPopup';

export default function RecallPage() {
  const { user } = useAuth();
  const isHO = ['ADMIN', 'HO_STAFF'].includes(user?.role);
  const isStore = ['STORE_STAFF', 'STORE_MANAGER'].includes(user?.role);
  const [recalls, setRecalls] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState(isStore && user?.store_id ? String(user.store_id) : 'all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [storeStaff, setStoreStaff] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ store_id: '', product_id: '', product_name: '', quantity: '', assigned_staff_id: '', remarks: '' });
  const [productStock, setProductStock] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const lookupTimer = useRef(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ phase: 'idle', percent: 0 });
  const [bulkStore, setBulkStore] = useState('');
  const [bulkStaff, setBulkStaff] = useState('');
  const limit = 50;

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  const loadRecalls = () => {
    const params = { page, limit };
    if (storeFilter !== 'all') params.store_id = storeFilter;
    if (statusFilter !== 'all') params.status = statusFilter;
    api.get('/recalls', { params }).then(r => { setRecalls(r.data.recalls); setTotal(r.data.total); }).catch(() => {});
  };
  useEffect(() => { loadRecalls(); }, [page, storeFilter, statusFilter]);

  const loadStaff = (storeId) => {
    if (!storeId) { setStoreStaff([]); return; }
    api.get('/crm/store-staff', { params: { store_id: storeId } }).then(r => setStoreStaff(r.data.staff)).catch(() => {});
  };

  const lookupProduct = (pid) => {
    setForm(f => ({ ...f, product_id: pid }));
    clearTimeout(lookupTimer.current);
    if (!pid || pid.length < 2) { setProductStock(null); return; }
    lookupTimer.current = setTimeout(() => {
      setLookingUp(true);
      api.get('/po/product-stock-info', { params: { product_id: pid.trim() } }).then(r => {
        const prods = r.data.products || [];
        if (prods.length > 0) {
          const p = prods[0];
          setForm(f => ({ ...f, product_name: p.product_name }));
          setProductStock(p);
        } else {
          setProductStock(null);
        }
      }).catch(() => setProductStock(null)).finally(() => setLookingUp(false));
    }, 400);
  };

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/recalls', { ...form, store_id: parseInt(form.store_id), quantity: parseFloat(form.quantity) || 0, assigned_staff_id: form.assigned_staff_id ? parseInt(form.assigned_staff_id) : null });
      toast.success('Recall request created'); setCreateOpen(false);
      setForm({ store_id: '', product_id: '', product_name: '', quantity: '', assigned_staff_id: '', remarks: '' });
      loadRecalls();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleBulkUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !bulkStore) { toast.error('Select a store first'); return; }
    setUploading(true); setUploadProgress({ phase: 'uploading', percent: 0 });
    const fd = new FormData(); fd.append('file', file);
    const params = new URLSearchParams({ store_id: bulkStore });
    if (bulkStaff) params.append('assigned_staff_id', bulkStaff);
    try {
      const res = await api.post(`/recalls/bulk-upload?${params}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => { const pct = Math.round((evt.loaded * 100) / (evt.total || 1)); setUploadProgress({ phase: pct >= 100 ? 'processing' : 'uploading', percent: pct }); },
      });
      setUploadProgress({ phase: 'done', percent: 100 });
      toast.success(`${res.data.success} recall requests created`);
      loadRecalls();
      setTimeout(() => setUploadProgress({ phase: 'idle', percent: 0 }), 3000);
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); setUploadProgress({ phase: 'idle', percent: 0 }); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleStatus = async (id, newStatus) => {
    try { await api.put(`/recalls/${id}/status?status=${newStatus}`); toast.success(`Status: ${newStatus}`); loadRecalls(); }
    catch { toast.error('Failed'); }
  };

  const totalPages = Math.ceil(total / limit);
  const sBadge = (s) => ({ pending: 'bg-amber-100 text-amber-700', acknowledged: 'bg-sky-100 text-sky-700', returned: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-slate-100 text-slate-500' }[s] || 'bg-slate-100 text-slate-600');

  return (
    <div data-testid="recall-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Product Recall / Return</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{total} recall requests</p>
        </div>
        {isHO && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs"><Plus className="w-3.5 h-3.5 mr-1.5" /> New Recall</Button></DialogTrigger>
            <DialogContent className="rounded-sm max-w-md">
              <DialogHeader><DialogTitle className="font-heading">Create Recall Request</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
                  <Select value={form.store_id} onValueChange={v => { setForm({...form, store_id: v}); loadStaff(v); setProductStock(null); }}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select store" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="font-body text-xs">HO ID {lookingUp && <span className="text-sky-500 text-[9px] ml-1">looking up...</span>}</Label>
                    <Input value={form.product_id} onChange={e => lookupProduct(e.target.value)} className="rounded-sm" placeholder="Enter product ID" /></div>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Quantity *</Label><Input type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required className="rounded-sm" /></div>
                </div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Product Name *</Label><Input value={form.product_name} onChange={e => setForm({...form, product_name: e.target.value})} required className="rounded-sm" /></div>
                {/* Live Stock Info */}
                {productStock && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-body text-slate-400 uppercase tracking-wider">Stock at Stores</span>
                      <span className="text-[11px] font-body font-medium text-slate-700">Total: {productStock.total_stock} strips</span>
                    </div>
                    {productStock.store_stock?.length > 0 ? (
                      <div className="grid grid-cols-2 gap-1">
                        {productStock.store_stock.map((s, i) => (
                          <div key={i} className={`flex items-center justify-between px-2 py-1 rounded-sm text-[11px] font-body ${form.store_id && s.store_id === parseInt(form.store_id) ? 'bg-sky-100 border border-sky-300' : 'bg-white border border-slate-100'}`}>
                            <span className="text-slate-600">{s.store}</span>
                            <span className={`font-bold tabular-nums ${s.stock > 0 ? 'text-emerald-700' : 'text-red-500'}`}>{s.stock}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-[11px] text-slate-400">No stock at any store</p>}
                    {form.store_id && (() => {
                      const storeStock = productStock.store_stock?.find(s => s.store_id === parseInt(form.store_id));
                      return storeStock ? (
                        <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
                          <span className="text-[11px] font-body text-sky-700 font-medium">Selected store stock: {storeStock.stock} strips</span>
                        </div>
                      ) : <p className="text-[11px] text-red-500 pt-1 border-t border-slate-200">No stock at selected store</p>;
                    })()}
                  </div>
                )}
                <div className="space-y-1.5"><Label className="font-body text-xs">Assign to Staff</Label>
                  <Select value={form.assigned_staff_id} onValueChange={v => setForm({...form, assigned_staff_id: v})}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>{storeStaff.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Remarks</Label><Textarea value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} className="rounded-sm" rows={2} /></div>
                <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>{saving ? 'Creating...' : 'Create Recall'}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Bulk Upload (HO only) */}
      {isHO && (
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Upload className="w-4 h-4 text-sky-500" /> Bulk Recall via Excel</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] font-body text-slate-500">Excel columns: HO ID, Product Name, Quantity. All items will be assigned to the selected store and staff.</p>
            <div className="flex gap-3 items-end flex-wrap">
              <div className="space-y-1"><span className="text-[9px] font-body text-slate-400 uppercase">Store *</span>
                <Select value={bulkStore} onValueChange={v => { setBulkStore(v); loadStaff(v); }}><SelectTrigger className="w-[180px] rounded-sm text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><span className="text-[9px] font-body text-slate-400 uppercase">Assign Staff</span>
                <Select value={bulkStaff} onValueChange={setBulkStaff}><SelectTrigger className="w-[180px] rounded-sm text-sm"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>{storeStaff.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent></Select></div>
              <div>
                <input type="file" accept=".xlsx,.xls" onChange={handleBulkUpload} disabled={uploading || !bulkStore} className="hidden" id="recall-upload" />
                <label htmlFor="recall-upload"><Button asChild className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={!bulkStore}><span><Upload className="w-3.5 h-3.5 mr-1.5" />Upload Excel</span></Button></label>
              </div>
            </div>
            <UploadProgress phase={uploadProgress.phase} percent={uploadProgress.percent} />
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3 flex-wrap">
          <Select value={storeFilter} onValueChange={v => { setStoreFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[180px] font-body text-sm rounded-sm"><SelectValue placeholder="All Stores" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-1.5">
            {['all', 'pending', 'acknowledged', 'returned', 'cancelled'].map(s => (
              <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" className={`rounded-sm font-body text-xs ${statusFilter === s ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
                onClick={() => { setStatusFilter(s); setPage(1); }}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-380px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['#', 'Store', 'Product ID', 'Product Name', 'Qty', 'Assigned To', 'Status', 'Created By', 'Date', 'Actions'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${h === 'Qty' ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {recalls.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-16"><RotateCcw className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No recall requests</p></TableCell></TableRow>
              ) : recalls.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50/50">
                  <TableCell className="font-mono text-[11px] text-slate-500">#{r.id}</TableCell>
                  <TableCell className="text-[12px] text-slate-600">{r.store_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-400">{r.product_id || '-'}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{r.product_name}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums font-medium">{r.quantity}</TableCell>
                  <TableCell className="text-[12px] text-violet-700 font-medium">{r.assigned_staff || '-'}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${sBadge(r.status)}`}>{r.status}</Badge></TableCell>
                  <TableCell className="text-[11px] text-slate-500">{r.created_by}</TableCell>
                  <TableCell className="text-[11px] text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {r.status === 'pending' && <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] text-sky-600" onClick={() => handleStatus(r.id, 'acknowledged')}><Check className="w-3 h-3 mr-0.5" />Ack</Button>}
                      {r.status === 'acknowledged' && <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] text-emerald-600" onClick={() => handleStatus(r.id, 'returned')}><Check className="w-3 h-3 mr-0.5" />Returned</Button>}
                      {r.status === 'pending' && <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] text-red-600" onClick={() => handleStatus(r.id, 'cancelled')}><X className="w-3 h-3 mr-0.5" />Cancel</Button>}
                      <ChatButton entityType="recall" entityId={r.id} details={[
                        { label: 'Product', value: r.product_name },
                        { label: 'Store', value: r.store_name }, { label: 'Qty', value: r.quantity },
                        { label: 'Assigned', value: r.assigned_staff || '-' }, { label: 'Status', value: r.status },
                      ]} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} | {total} recalls</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="h-7 w-7 p-0 rounded-sm"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages} className="h-7 w-7 p-0 rounded-sm"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
