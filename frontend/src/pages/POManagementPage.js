import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Checkbox } from '../components/ui/checkbox';
import { toast } from 'sonner';
import { FileText, Plus, Check, X, Search, Upload, Truck, Package, Trash2 } from 'lucide-react';

export default function POManagementPage() {
  const [orders, setOrders] = useState([]);
  const [storeRequests, setStoreRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [detailDialog, setDetailDialog] = useState(null);
  const [stockInfo, setStockInfo] = useState(null);
  // Emergency PO review items
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewCat, setReviewCat] = useState('all');
  const [reviewStatus, setReviewStatus] = useState('all');
  const [reviewSelected, setReviewSelected] = useState([]);
  const [bulkSupplier, setBulkSupplier] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  // Create PO form
  const [createOpen, setCreateOpen] = useState(false);
  const [poForm, setPoForm] = useState({ supplier_name: '', remarks: '', request_id: null });
  const [poItems, setPoItems] = useState([]);
  const [poSearch, setPoSearch] = useState('');
  const [poSugg, setPoSugg] = useState([]);
  const [showPoSugg, setShowPoSugg] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [manualCost, setManualCost] = useState('');
  // PO Detail popup
  const [poDetail, setPoDetail] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [editSupplier, setEditSupplier] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [newComment, setNewComment] = useState('');

  const openPoDetail = async (poId) => {
    try {
      const res = await api.get(`/po/${poId}`);
      setPoDetail(res.data);
      setEditItems(res.data.items.map(it => ({ ...it })));
      setEditSupplier(res.data.po.supplier_name);
      setEditRemarks(res.data.po.remarks || '');
      setNewComment('');
    } catch { toast.error('Failed to load PO'); }
  };

  const addComment = async () => {
    if (!newComment.trim() || !poDetail) return;
    try {
      await api.post(`/po/${poDetail.po.id}/comment`, { message: newComment });
      toast.success('Comment added');
      setNewComment('');
      openPoDetail(poDetail.po.id);
    } catch { toast.error('Failed'); }
  };

  const savePoEdit = async () => {
    try {
      await api.put(`/po/${poDetail.po.id}/update`, {
        supplier_name: editSupplier, remarks: editRemarks,
        items: editItems.map(it => ({ product_id: it.product_id, product_name: it.product_name, is_registered: it.is_registered, quantity: it.quantity, landing_cost: it.landing_cost })),
      });
      toast.success('PO updated'); setPoDetail(null); loadData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const deletePo = async (poId) => {
    try { await api.delete(`/po/${poId}`); toast.success('PO deleted'); setPoDetail(null); loadData(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const generatePDF = async (poId) => {
    try {
      const res = await api.get(`/po/${poId}/pdf`);
      const printWindow = window.open('', '_blank');
      printWindow.document.write(res.data.html);
      printWindow.document.close();
      printWindow.onload = () => { printWindow.print(); };
    } catch { toast.error('Failed to generate PDF'); }
  };

  const editQty = (idx, val) => { const n = [...editItems]; n[idx].quantity = parseFloat(val) || 0; n[idx].estimated_value = round2(n[idx].quantity * n[idx].landing_cost); setEditItems(n); };
  const editCost = (idx, val) => { const n = [...editItems]; n[idx].landing_cost = parseFloat(val) || 0; n[idx].estimated_value = round2(n[idx].quantity * n[idx].landing_cost); setEditItems(n); };
  const removeEditItem = (idx) => setEditItems(editItems.filter((_, i) => i !== idx));
  const round2 = (v) => Math.round(v * 100) / 100;
  const editTotal = editItems.reduce((s, i) => s + (i.quantity || 0) * (i.landing_cost || 0), 0);

  // Review helpers
  const toggleReviewSelect = (id) => setReviewSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const handleBulkReview = async () => {
    if (reviewSelected.length === 0) return;
    try {
      await api.put('/po/purchase-review/update', { item_ids: reviewSelected, supplier: bulkSupplier || null, status: bulkStatus || null });
      toast.success(`Updated ${reviewSelected.length} items`);
      setReviewSelected([]); setBulkSupplier(''); setBulkStatus(''); loadData();
    } catch { toast.error('Failed'); }
  };
  const updateReviewItem = async (id, supplier, status) => {
    try {
      await api.put('/po/purchase-review/update', { item_ids: [id], supplier: supplier || null, status: status || null });
      loadData();
    } catch { toast.error('Failed'); }
  };
  // Suppliers + Sub-cat
  const [suppliers, setSuppliers] = useState([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [uploadSupplier, setUploadSupplier] = useState('');
  const [subCategories, setSubCategories] = useState([]);
  const [selectedSubCat, setSelectedSubCat] = useState('');
  const [subcatProducts, setSubcatProducts] = useState([]);
  const [subcatSuppliers, setSubcatSuppliers] = useState([]);
  const [subcatSearch, setSubcatSearch] = useState('');
  const sugRef = useRef(null);
  const supRef = useRef(null);

  const loadData = () => {
    api.get('/po/list', { params: statusFilter !== 'all' ? { status: statusFilter } : {} }).then(r => setOrders(r.data.orders)).catch(() => {});
    api.get('/po/store-requests', { params: { status: 'pending' } }).then(r => setStoreRequests(r.data.requests)).catch(() => {});
    const rp = {};
    if (reviewCat !== 'all') rp.po_category = reviewCat;
    if (reviewStatus !== 'all') rp.status = reviewStatus;
    api.get('/po/purchase-review', { params: rp }).then(r => setReviewItems(r.data.items)).catch(() => {});
  };
  useEffect(() => { loadData(); }, [statusFilter, reviewCat, reviewStatus]);

  // Load suppliers
  useEffect(() => {
    if (supplierSearch.length < 1) { api.get('/po/suppliers').then(r => setSuppliers(r.data.suppliers)).catch(() => {}); return; }
    const t = setTimeout(() => { api.get('/po/suppliers', { params: { search: supplierSearch } }).then(r => setSuppliers(r.data.suppliers)).catch(() => {}); }, 200);
    return () => clearTimeout(t);
  }, [supplierSearch]);
  useEffect(() => { api.get('/po/suppliers').then(r => setSuppliers(r.data.suppliers)).catch(() => {}); }, []);
  useEffect(() => { api.get('/products/sub-categories').then(r => setSubCategories(r.data.sub_categories || [])).catch(() => {}); }, []);

  // Load products + suppliers when sub-category selected in PO form
  useEffect(() => {
    if (!selectedSubCat) { setSubcatProducts([]); setSubcatSuppliers([]); return; }
    api.get('/po/subcategory-data', { params: { sub_category: selectedSubCat } })
      .then(r => { setSubcatProducts(r.data.products); setSubcatSuppliers(r.data.suppliers); }).catch(() => {});
  }, [selectedSubCat]);

  useEffect(() => {
    if (poSearch.length < 2) { setPoSugg([]); return; }
    const t = setTimeout(() => { api.get('/products', { params: { search: poSearch, limit: 15 } }).then(r => { setPoSugg(r.data.products); setShowPoSugg(true); }).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [poSearch]);
  useEffect(() => {
    const h = (e) => {
      if (sugRef.current && !sugRef.current.contains(e.target)) setShowPoSugg(false);
      if (supRef.current && !supRef.current.contains(e.target)) setShowSuppliers(false);
    };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  const addPoProduct = (p) => {
    if (poItems.some(i => i.product_id === p.product_id)) { toast.warning('Already added'); return; }
    api.get('/po/product-stock-info', { params: { product_id: p.product_id } }).then(r => {
      const info = r.data.products?.[0];
      setPoItems(prev => [...prev, {
        product_id: p.product_id, product_name: p.product_name, is_registered: true,
        quantity: 1, landing_cost: info?.landing_cost || p.landing_cost || 0,
        store_stock: info?.store_stock || [], total_stock: info?.total_stock || 0,
      }]);
    }).catch(() => {
      setPoItems(prev => [...prev, { product_id: p.product_id, product_name: p.product_name, is_registered: true, quantity: 1, landing_cost: p.landing_cost || 0, store_stock: [], total_stock: 0 }]);
    });
    setPoSearch(''); setShowPoSugg(false);
  };
  const addManualProduct = () => {
    if (!manualName) return;
    setPoItems([...poItems, { product_id: null, product_name: manualName, is_registered: false, quantity: parseFloat(manualQty) || 1, landing_cost: parseFloat(manualCost) || 0 }]);
    setManualName(''); setManualQty(''); setManualCost('');
  };
  const updatePoItem = (idx, field, val) => { const n = [...poItems]; n[idx][field] = field === 'product_name' ? val : parseFloat(val) || 0; setPoItems(n); };
  const poTotal = poItems.reduce((s, i) => s + i.quantity * i.landing_cost, 0);

  const handleCreatePO = async () => {
    if (!poForm.supplier_name || poItems.length === 0) { toast.error('Supplier and items required'); return; }
    setSaving(true);
    try {
      const res = await api.post('/po/create', { ...poForm, items: poItems });
      toast.success(`PO ${res.data.po_number} created: INR ${res.data.total_value.toLocaleString('en-IN')}`);
      setCreateOpen(false); setPoForm({ supplier_name: '', remarks: '', request_id: null }); setPoItems([]);
      loadData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAction = async (poId, action) => {
    try {
      await api.put(`/po/${poId}/${action}`);
      toast.success(`PO ${action}d`); loadData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const handleFulfillment = async (poId, status) => {
    try { await api.put(`/po/${poId}/fulfillment?status=${status}`); toast.success(`Updated: ${status}`); loadData(); }
    catch { toast.error('Failed'); }
  };

  const viewRequestStock = async (reqId) => {
    try { const res = await api.get(`/po/store-requests/${reqId}/stock-info`); setStockInfo(res.data); }
    catch { toast.error('Failed to load'); }
  };

  const createPOFromRequest = (req) => {
    setPoForm({ supplier_name: '', remarks: `From store request #${req.id}`, request_id: req.id });
    setPoItems(req.items.map(it => ({ product_id: it.product_id, product_name: it.product_name, is_registered: !!it.product_id, quantity: it.quantity, landing_cost: it.landing_cost })));
    setCreateOpen(true);
  };

  const handleSubcatUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await api.post('/po/upload-subcategory', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      toast.success(`${res.data.purchase_orders?.length} POs created by sub-category`);
      loadData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); }
    e.target.value = '';
  };

  const sBadge = (s) => ({ draft: 'bg-slate-100 text-slate-600', approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-red-50 text-red-700', po_created: 'bg-sky-50 text-sky-700' }[s] || 'bg-amber-50 text-amber-700');
  const fBadge = (s) => ({ received: 'bg-emerald-50 text-emerald-700', ordered: 'bg-sky-50 text-sky-700', verified: 'bg-violet-50 text-violet-700' }[s] || 'bg-slate-100 text-slate-500');

  return (
    <div data-testid="po-management-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Purchase Orders</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Manage POs, store requests & sub-category orders</p>
        </div>
        <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={() => { setPoForm({ supplier_name: '', remarks: '', request_id: null }); setPoItems([]); setCreateOpen(true); }}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Create PO
        </Button>
      </div>

      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList className="rounded-sm">
          <TabsTrigger value="requests" className="rounded-sm text-xs font-body">Store Requests ({storeRequests.length})</TabsTrigger>
          <TabsTrigger value="emergency" className="rounded-sm text-xs font-body">Emergency PO ({reviewItems.length})</TabsTrigger>
          <TabsTrigger value="orders" className="rounded-sm text-xs font-body">Purchase Orders ({orders.length})</TabsTrigger>
          <TabsTrigger value="upload" className="rounded-sm text-xs font-body">Sub-Category Upload</TabsTrigger>
        </TabsList>

        {/* Store Requests Tab */}
        <TabsContent value="requests">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-280px)]">
              <Table><TableHeader><TableRow className="border-b-2 border-slate-100">
                {['#', 'Store', 'Reason', 'Customer', 'Items', 'Value', 'Status', 'Actions'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                ))}</TableRow></TableHeader>
                <TableBody>
                  {storeRequests.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12"><Package className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400">No pending requests</p></TableCell></TableRow>
                  ) : storeRequests.map(r => (
                    <TableRow key={r.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-[11px]">#{r.id}</TableCell>
                      <TableCell className="text-[12px]">{r.store_name}</TableCell>
                      <TableCell><Badge className={`text-[9px] rounded-sm ${sBadge(r.request_reason === 'emergency_purchase' ? 'rejected' : 'draft')}`}>{r.request_reason?.replace('_', ' ')}</Badge></TableCell>
                      <TableCell className="text-[11px]">{r.customer_name ? `${r.customer_name} (${r.customer_mobile})` : '-'}</TableCell>
                      <TableCell className="text-[12px] tabular-nums">{r.total_items}</TableCell>
                      <TableCell className="text-[12px] tabular-nums font-medium">INR {r.total_value?.toLocaleString('en-IN')}</TableCell>
                      <TableCell><Badge className={`text-[9px] rounded-sm ${sBadge(r.status)}`}>{r.status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-5 px-1.5 rounded-sm text-[9px]" onClick={() => viewRequestStock(r.id)}>Stock Info</Button>
                          <Button size="sm" variant="outline" className="h-5 px-1.5 rounded-sm text-[9px] text-sky-600" onClick={() => createPOFromRequest(r)}>Create PO</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
          {stockInfo && (
            <Card className="border-sky-200 bg-sky-50/30 shadow-sm rounded-sm mt-3">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold">Stock & Sales Info - Request #{stockInfo.request_id} ({stockInfo.store_name})</CardTitle></CardHeader>
              <CardContent>{stockInfo.products?.map((p, i) => (
                <div key={i} className="mb-3 p-3 bg-white rounded-sm border border-slate-200">
                  <p className="text-[13px] font-body font-medium text-slate-800">{p.product_name} <span className="text-slate-400 text-[10px]">({p.product_id})</span> — Requested: {p.requested_qty}</p>
                  <div className="flex gap-4 mt-1 text-[11px] font-body">
                    <span className="text-sky-700">Sales 30d: {p.sales_30d}</span>
                    <span className="text-sky-600">Sales 90d: {p.sales_90d}</span>
                  </div>
                  {p.store_stock?.length > 0 && (
                    <div className="mt-1 flex gap-2 flex-wrap">{p.store_stock.map((s, j) => (
                      <Badge key={j} variant="secondary" className="text-[9px] rounded-sm">{s.store}: {s.stock}</Badge>
                    ))}</div>
                  )}
                  {(!p.store_stock || p.store_stock.length === 0) && <p className="text-[10px] text-red-500 mt-1">No stock in any store</p>}
                </div>
              ))}</CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Emergency PO Review Tab */}
        <TabsContent value="emergency">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-3 flex gap-3 flex-wrap items-end">
              <div className="flex gap-1.5">
                {['all', 'BRAND-RX', 'GEN-RX', 'OTC', 'OTX'].map(c => (
                  <Button key={c} variant={reviewCat === c ? 'default' : 'outline'} size="sm"
                    className={`rounded-sm font-body text-xs ${reviewCat === c ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
                    onClick={() => setReviewCat(c)}>{c === 'all' ? 'All' : c}</Button>
                ))}
              </div>
              <Select value={reviewStatus} onValueChange={setReviewStatus}>
                <SelectTrigger className="w-[110px] h-7 text-xs rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="ordered">Ordered</SelectItem></SelectContent>
              </Select>
              {reviewSelected.length > 0 && (
                <div className="flex gap-2 items-center ml-auto border-l pl-3 border-slate-200">
                  <span className="text-[11px] font-body text-sky-700 font-medium">{reviewSelected.length} selected</span>
                  <Input placeholder="Supplier..." value={bulkSupplier} onChange={e => setBulkSupplier(e.target.value)} className="w-[140px] h-7 rounded-sm text-sm" />
                  <Select value={bulkStatus} onValueChange={setBulkStatus}>
                    <SelectTrigger className="w-[90px] h-7 text-[10px] rounded-sm"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent><SelectItem value="approved">Approve</SelectItem><SelectItem value="ordered">Ordered</SelectItem><SelectItem value="rejected">Reject</SelectItem></SelectContent>
                  </Select>
                  <Button size="sm" className="h-7 bg-sky-500 hover:bg-sky-600 rounded-sm text-xs" onClick={handleBulkReview}>Apply</Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm rounded-sm mt-3">
            <div className="overflow-auto max-h-[calc(100vh-350px)]">
              <Table><TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
                <TableHead className="w-[30px] py-3"><input type="checkbox" className="rounded" checked={reviewSelected.length === reviewItems.length && reviewItems.length > 0}
                  onChange={e => e.target.checked ? setReviewSelected(reviewItems.map(i => i.id)) : setReviewSelected([])} /></TableHead>
                {['Store', 'Product', 'Category', 'Qty', 'L.Cost', 'Primary', 'Secondary', 'Assigned', 'Status'].map(h => (
                  <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Qty', 'L.Cost'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow></TableHeader>
              <TableBody>
                {reviewItems.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-16"><Package className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No items. Set category rules in Admin and submit store requests.</p></TableCell></TableRow>
                ) : reviewItems.map(it => (
                  <TableRow key={it.id} className={`hover:bg-slate-50/50 ${reviewSelected.includes(it.id) ? 'bg-sky-50/50' : ''}`}>
                    <TableCell className="py-1.5"><input type="checkbox" className="rounded" checked={reviewSelected.includes(it.id)} onChange={() => toggleReviewSelect(it.id)} /></TableCell>
                    <TableCell className="text-[11px] text-slate-600">{it.store_name}</TableCell>
                    <TableCell className="text-[12px] font-medium text-slate-800 max-w-[180px] truncate">{it.product_name}</TableCell>
                    <TableCell><Badge className={`text-[8px] rounded-sm ${{
                      'BRAND-RX': 'bg-blue-50 text-blue-700', 'GEN-RX': 'bg-violet-50 text-violet-700',
                      'OTC': 'bg-emerald-50 text-emerald-700', 'OTX': 'bg-amber-50 text-amber-700',
                    }[it.po_category] || 'bg-slate-100 text-slate-600'}`}>{it.po_category}</Badge></TableCell>
                    <TableCell className="text-right text-[11px] tabular-nums">{it.quantity}</TableCell>
                    <TableCell className="text-right text-[11px] tabular-nums">{it.landing_cost?.toFixed(2)}</TableCell>
                    <TableCell className="text-[10px] text-sky-700 cursor-pointer hover:underline" onClick={() => updateReviewItem(it.id, it.suppliers?.primary)}>{it.suppliers?.primary || '-'}</TableCell>
                    <TableCell className="text-[10px] text-slate-500 cursor-pointer hover:underline" onClick={() => updateReviewItem(it.id, it.suppliers?.secondary)}>{it.suppliers?.secondary || '-'}</TableCell>
                    <TableCell>{it.selected_supplier
                      ? <Badge className="text-[9px] rounded-sm bg-emerald-50 text-emerald-700">{it.selected_supplier}</Badge>
                      : <Select value="" onValueChange={v => updateReviewItem(it.id, v)}>
                          <SelectTrigger className="h-5 w-[70px] text-[9px] rounded-sm px-1"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{Object.entries(it.suppliers || {}).map(([t, n]) => n && <SelectItem key={t} value={n}>{n}</SelectItem>)}</SelectContent>
                        </Select>}
                    </TableCell>
                    <TableCell>
                      <Select value="" onValueChange={v => updateReviewItem(it.id, null, v)}>
                        <SelectTrigger className={`h-5 w-[65px] text-[9px] rounded-sm px-1 ${{
                          approved: 'bg-emerald-50 text-emerald-700', ordered: 'bg-sky-50 text-sky-700', rejected: 'bg-red-50 text-red-700',
                        }[it.item_status] || 'bg-amber-50 text-amber-700'}`}><SelectValue placeholder={it.item_status} /></SelectTrigger>
                        <SelectContent><SelectItem value="approved">Approve</SelectItem><SelectItem value="ordered">Ordered</SelectItem><SelectItem value="rejected">Reject</SelectItem></SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            </div>
          </Card>
        </TabsContent>

        {/* Purchase Orders Tab */}
        <TabsContent value="orders">
          <div className="flex gap-1.5 mb-3">{['all', 'draft', 'approved', 'rejected'].map(s => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm"
              className={`rounded-sm font-body text-xs capitalize ${statusFilter === s ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
              onClick={() => setStatusFilter(s)}>{s}</Button>
          ))}</div>
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-320px)]">
              <Table><TableHeader><TableRow className="border-b-2 border-slate-100">
                {['PO #', 'Supplier', 'Type', 'Store', 'Qty', 'Value', 'Status', 'Fulfillment', 'Actions'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Qty', 'Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}</TableRow></TableHeader>
                <TableBody>
                  {orders.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-12"><FileText className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400">No purchase orders</p></TableCell></TableRow>
                  ) : orders.map(po => (
                    <TableRow key={po.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => openPoDetail(po.id)}>
                      <TableCell className="font-mono text-[11px] text-sky-700 font-medium">{po.po_number}</TableCell>
                      <TableCell className="text-[12px]">{po.supplier_name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[9px] rounded-sm">{po.po_type?.replace('_', ' ')}</Badge></TableCell>
                      <TableCell className="text-[12px]">{po.store_name}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{po.total_qty}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {po.total_value?.toLocaleString('en-IN')}</TableCell>
                      <TableCell><Badge className={`text-[9px] rounded-sm ${sBadge(po.status)}`}>{po.status}</Badge></TableCell>
                      <TableCell><Badge className={`text-[9px] rounded-sm ${fBadge(po.fulfillment_status)}`}>{po.fulfillment_status}</Badge></TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Button size="sm" variant="outline" className="h-5 px-2 rounded-sm text-[9px]" onClick={() => openPoDetail(po.id)}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Sub-Category Upload Tab */}
        <TabsContent value="upload">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Upload className="w-4 h-4 text-sky-500" /> Upload PO by Sub-Category</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[11px] font-body text-slate-500">Upload Excel with: <b>HO ID</b>, <b>Product Name</b>, <b>Qty</b>. System auto-detects sub-category from Product Master and creates separate POs per sub-category. Supplier can be assigned later.</p>
              <div className="flex gap-3">
                <input type="file" accept=".xlsx,.xls" onChange={handleSubcatUpload} className="hidden" id="subcat-upload" />
                <label htmlFor="subcat-upload"><Button asChild className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs"><span><Upload className="w-3.5 h-3.5 mr-1.5" /> Upload Excel</span></Button></label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create PO Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-sm max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle className="font-heading">Create Purchase Order</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Step 1: Sub Category */}
            <div className="space-y-1.5">
              <Label className="font-body text-xs font-medium">1. Select Sub Category</Label>
              <Select value={selectedSubCat} onValueChange={v => { setSelectedSubCat(v); setPoItems([]); setSubcatSearch(''); }}>
                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select sub category to load products & suppliers" /></SelectTrigger>
                <SelectContent className="max-h-[250px]">{subCategories.map(sc => <SelectItem key={sc} value={sc}>{sc}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Auto-loaded suppliers for sub-category */}
            {selectedSubCat && subcatSuppliers.length > 0 && (
              <div className="p-3 bg-sky-50/50 border border-sky-200 rounded-sm">
                <p className="text-[10px] font-body text-sky-600 uppercase tracking-wider mb-1.5">Suppliers for {selectedSubCat}</p>
                <div className="flex gap-1.5 flex-wrap">{subcatSuppliers.map(s => <Badge key={s} variant="secondary" className="text-[10px] rounded-sm">{s}</Badge>)}</div>
              </div>
            )}

            {/* Step 2: Supplier selection */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5" ref={supRef}>
                <Label className="font-body text-xs font-medium">2. Select Supplier *</Label>
                <Select value={poForm.supplier_name} onValueChange={v => setPoForm({...poForm, supplier_name: v})}>
                  <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {(selectedSubCat && subcatSuppliers.length > 0 ? subcatSuppliers : suppliers).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Remarks</Label>
                <Input value={poForm.remarks} onChange={e => setPoForm({...poForm, remarks: e.target.value})} className="rounded-sm" /></div>
            </div>

            {/* Step 3: Products from sub-category */}
            {selectedSubCat && subcatProducts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-body text-xs font-medium">3. Select Products ({subcatProducts.length} in {selectedSubCat})</Label>
                  <div className="relative w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <Input placeholder="Filter..." value={subcatSearch} onChange={e => setSubcatSearch(e.target.value)} className="pl-9 rounded-sm text-sm h-8" /></div>
                </div>
                <Card className="border-slate-200 rounded-sm">
                  <div className="max-h-[200px] overflow-auto">
                    <Table><TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b border-slate-100">
                      {['', 'Product', 'ID', 'Supplier', 'L.Cost', 'MRP'].map(h => (
                        <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-2 ${['L.Cost', 'MRP'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                      ))}
                    </TableRow></TableHeader>
                    <TableBody>
                      {(subcatSearch ? subcatProducts.filter(p => p.product_name.toLowerCase().includes(subcatSearch.toLowerCase())) : subcatProducts).map(p => {
                        const added = poItems.some(i => i.product_id === p.product_id);
                        return (
                          <TableRow key={p.product_id} className={`hover:bg-sky-50/50 cursor-pointer ${added ? 'bg-emerald-50/30' : ''}`}
                            onClick={() => { if (!added) {
                              api.get('/po/product-stock-info', { params: { product_id: p.product_id } }).then(r => {
                                const info = r.data.products?.[0];
                                setPoItems(prev => [...prev, { product_id: p.product_id, product_name: p.product_name, is_registered: true, quantity: 1,
                                  landing_cost: info?.landing_cost || p.landing_cost || 0, store_stock: info?.store_stock || [], total_stock: info?.total_stock || 0 }]);
                              }).catch(() => { setPoItems(prev => [...prev, { product_id: p.product_id, product_name: p.product_name, is_registered: true, quantity: 1, landing_cost: p.landing_cost || 0, store_stock: [], total_stock: 0 }]); });
                            } }}>
                            <TableCell className="w-[30px] py-1"><Checkbox checked={added} className="rounded-sm" /></TableCell>
                            <TableCell className="text-[12px] font-medium text-slate-800 py-1">{p.product_name}</TableCell>
                            <TableCell className="font-mono text-[10px] text-slate-400">{p.product_id}</TableCell>
                            <TableCell className="text-[10px] text-slate-500">{p.primary_supplier || '-'}</TableCell>
                            <TableCell className="text-right text-[11px] tabular-nums">{p.landing_cost.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-[11px] tabular-nums">{p.mrp.toFixed(2)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody></Table>
                  </div>
                </Card>
              </div>
            )}

            {/* Also allow search from full product master */}
            <div ref={sugRef} className="space-y-1.5">
              <Label className="font-body text-[10px] text-slate-400">Or search from all products</Label>
              <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Search any product..." value={poSearch} onChange={e => setPoSearch(e.target.value)} className="pl-9 rounded-sm text-sm" autoComplete="off" />
                {showPoSugg && poSugg.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-[150px] overflow-auto">
                    {poSugg.map(p => (<button key={p.product_id} type="button" className="w-full text-left px-3 py-2 hover:bg-sky-50 border-b border-slate-50"
                      onClick={() => addPoProduct(p)}><span className="text-[12px] font-medium">{p.product_name}</span> <span className="text-[10px] text-slate-400">L.Cost: {p.landing_cost}</span></button>))}
                  </div>)}
              </div>
            </div>

            {/* Manual non-registered product */}
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1"><Label className="font-body text-[10px] text-slate-400">Non-Registered Product</Label>
                <Input placeholder="Product name" value={manualName} onChange={e => setManualName(e.target.value)} className="rounded-sm text-sm" /></div>
              <Input placeholder="Qty" type="number" value={manualQty} onChange={e => setManualQty(e.target.value)} className="w-[70px] rounded-sm text-sm" />
              <Input placeholder="Cost" type="number" value={manualCost} onChange={e => setManualCost(e.target.value)} className="w-[80px] rounded-sm text-sm" />
              <Button variant="outline" size="sm" className="rounded-sm text-xs" onClick={addManualProduct} disabled={!manualName}><Plus className="w-3 h-3" /></Button>
            </div>

            {/* Selected PO Items */}
            {poItems.length > 0 && (
              <Card className="border-emerald-200 rounded-sm">
                <Table><TableHeader><TableRow className="border-b border-slate-100">
                  {['Product', 'Type', 'Stock', 'Qty', 'Cost', 'Value', ''].map(h => (
                    <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-2 ${['Qty', 'Cost', 'Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                  ))}</TableRow></TableHeader>
                  <TableBody>{poItems.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-[12px] font-medium py-1.5">{it.product_name}</TableCell>
                      <TableCell>{it.is_registered ? <Badge className="text-[8px] rounded-sm bg-emerald-50 text-emerald-700">Reg</Badge> : <Badge className="text-[8px] rounded-sm bg-amber-50 text-amber-700">Manual</Badge>}</TableCell>
                      <TableCell className="py-1">
                        <div className="flex gap-0.5 flex-wrap">{it.store_stock?.length > 0
                          ? it.store_stock.map((s, j) => <Badge key={j} variant="secondary" className="text-[7px] rounded-sm px-1">{s.store}:{s.stock}</Badge>)
                          : <span className="text-[9px] text-slate-400">{it.is_registered ? 'No stock' : '-'}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right py-1.5"><Input type="number" min={1} value={it.quantity} onChange={e => updatePoItem(i, 'quantity', e.target.value)} className="w-[60px] h-6 text-right rounded-sm text-[11px] ml-auto" /></TableCell>
                      <TableCell className="text-right py-1.5"><Input type="number" value={it.landing_cost} onChange={e => updatePoItem(i, 'landing_cost', e.target.value)} className="w-[70px] h-6 text-right rounded-sm text-[11px] ml-auto" /></TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {(it.quantity * it.landing_cost).toFixed(2)}</TableCell>
                      <TableCell><Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={() => setPoItems(poItems.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button></TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
                <div className="flex justify-between items-center px-4 py-2 bg-emerald-50 border-t border-emerald-100">
                  <span className="text-[12px] font-body text-emerald-800">{poItems.length} items</span>
                  <span className="text-lg font-heading font-bold text-emerald-700 tabular-nums">INR {poTotal.toFixed(2)}</span>
                </div>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={handleCreatePO}
              disabled={saving || !poForm.supplier_name || poItems.length === 0}>
              {saving ? 'Creating...' : `Create PO (INR ${poTotal.toFixed(2)})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Detail Popup */}
      <Dialog open={!!poDetail} onOpenChange={v => { if (!v) setPoDetail(null); }}>
        <DialogContent className="rounded-sm max-w-3xl max-h-[85vh] overflow-auto">
          {poDetail && (<>
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-3">
                <span>{poDetail.po.po_number}</span>
                <Badge className={`text-[10px] rounded-sm ${sBadge(poDetail.po.status)}`}>{poDetail.po.status}</Badge>
                <Badge className={`text-[10px] rounded-sm ${fBadge(poDetail.po.fulfillment_status)}`}>{poDetail.po.fulfillment_status}</Badge>
              </DialogTitle>
            </DialogHeader>
            {/* PO Header */}
            <div className="grid grid-cols-3 gap-3 text-[12px] font-body">
              <div><span className="text-slate-400">Store:</span> <span className="font-medium">{poDetail.po.store_name}</span></div>
              <div><span className="text-slate-400">Type:</span> <span className="font-medium">{poDetail.po.po_type?.replace('_', ' ')}</span></div>
              <div><span className="text-slate-400">Created:</span> <span>{poDetail.po.created_at ? new Date(poDetail.po.created_at).toLocaleDateString() : '-'}</span></div>
            </div>
            {/* Editable fields (only for draft) */}
            {poDetail.po.status === 'draft' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="font-body text-xs">Supplier</Label>
                  <Input value={editSupplier} onChange={e => setEditSupplier(e.target.value)} className="rounded-sm" /></div>
                <div className="space-y-1"><Label className="font-body text-xs">Remarks</Label>
                  <Input value={editRemarks} onChange={e => setEditRemarks(e.target.value)} className="rounded-sm" /></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-[12px] font-body">
                <div><span className="text-slate-400">Supplier:</span> <span className="font-medium">{poDetail.po.supplier_name}</span></div>
                <div><span className="text-slate-400">Remarks:</span> <span>{poDetail.po.remarks || '-'}</span></div>
              </div>
            )}
            {/* Items Table with Stock */}
            <Card className="border-slate-200 rounded-sm">
              <div className="max-h-[350px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b border-slate-100">
                    {['Product', 'ID', 'Stock (All Stores)', poDetail.po.status === 'draft' ? 'Qty' : 'Qty', poDetail.po.status === 'draft' ? 'L.Cost' : 'L.Cost', 'Value', poDetail.po.status === 'draft' ? '' : ''].filter(Boolean).map(h => (
                      <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-2 ${['Qty', 'L.Cost', 'Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow></TableHeader>
                  <TableBody>
                    {(poDetail.po.status === 'draft' ? editItems : poDetail.items).map((it, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-[12px] font-medium text-slate-800 py-1.5 max-w-[200px] truncate">{it.product_name}</TableCell>
                        <TableCell className="font-mono text-[10px] text-slate-400">{it.product_id || '-'}</TableCell>
                        <TableCell className="py-1">
                          <div className="flex gap-0.5 flex-wrap">{it.store_stock?.length > 0
                            ? it.store_stock.map((s, j) => <Badge key={j} variant="secondary" className="text-[7px] rounded-sm px-1">{s.store}:{s.stock}</Badge>)
                            : <span className="text-[9px] text-red-400">No stock</span>}
                          </div>
                        </TableCell>
                        {poDetail.po.status === 'draft' ? (
                          <>
                            <TableCell className="text-right py-1"><Input type="number" min={1} value={it.quantity} onChange={e => editQty(i, e.target.value)} className="w-[60px] h-6 text-right rounded-sm text-[11px] ml-auto" /></TableCell>
                            <TableCell className="text-right py-1"><Input type="number" value={it.landing_cost} onChange={e => editCost(i, e.target.value)} className="w-[70px] h-6 text-right rounded-sm text-[11px] ml-auto" /></TableCell>
                            <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {round2(it.quantity * it.landing_cost).toLocaleString('en-IN')}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={() => removeEditItem(i)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-right text-[12px] tabular-nums">{it.quantity}</TableCell>
                            <TableCell className="text-right text-[12px] tabular-nums">{it.landing_cost?.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {it.estimated_value?.toLocaleString('en-IN')}</TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between items-center px-4 py-2 bg-sky-50 border-t border-sky-100">
                <span className="text-[12px] font-body text-sky-800">{(poDetail.po.status === 'draft' ? editItems : poDetail.items).length} items</span>
                <span className="text-lg font-heading font-bold text-sky-700 tabular-nums">INR {poDetail.po.status === 'draft' ? editTotal.toFixed(2) : poDetail.po.total_value?.toLocaleString('en-IN')}</span>
              </div>
            </Card>
            {/* Communications */}
            <div className="space-y-2">
              <Label className="font-body text-xs font-medium">Communications</Label>
              <div className="flex gap-2">
                <Input placeholder="Add comment..." value={newComment} onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addComment()} className="rounded-sm text-sm flex-1" />
                <Button variant="outline" size="sm" className="rounded-sm text-xs" onClick={addComment} disabled={!newComment.trim()}>Send</Button>
              </div>
              {poDetail.comments?.length > 0 && (
                <div className="max-h-[150px] overflow-auto space-y-1.5 border border-slate-200 rounded-sm p-2">
                  {poDetail.comments.map(c => (
                    <div key={c.id} className="flex gap-2 py-1.5 border-b border-slate-50 last:border-0">
                      <div className="w-6 h-6 bg-sky-100 rounded-full flex items-center justify-center shrink-0"><span className="text-[9px] font-bold text-sky-700">{c.user_name?.[0]}</span></div>
                      <div><p className="text-[11px] font-body"><span className="font-medium text-slate-800">{c.user_name}</span> <span className="text-slate-400">{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span></p>
                        <p className="text-[12px] font-body text-slate-700">{c.message}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity Log */}
            {poDetail.activity_log?.length > 0 && (
              <div className="space-y-1.5">
                <Label className="font-body text-xs font-medium text-slate-500">Activity Log</Label>
                <div className="max-h-[120px] overflow-auto border border-slate-100 rounded-sm p-2 bg-slate-50/50">
                  {poDetail.activity_log.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-slate-100 last:border-0 text-[10px] font-body">
                      <span className="text-slate-400 shrink-0">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                      <span className="font-medium text-slate-600">{a.user_name}</span>
                      <span className="text-slate-500">{a.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end flex-wrap">
              <Button variant="outline" className="rounded-sm font-body text-xs" onClick={() => generatePDF(poDetail.po.id)}>
                <FileText className="w-3 h-3 mr-1" /> Print PO
              </Button>
              {poDetail.po.status === 'draft' && (<>
                <Button variant="outline" className="rounded-sm font-body text-xs text-red-600 hover:bg-red-50" onClick={() => deletePo(poDetail.po.id)}>
                  <Trash2 className="w-3 h-3 mr-1" /> Delete PO
                </Button>
                <Button variant="outline" className="rounded-sm font-body text-xs" onClick={savePoEdit}>Save Changes</Button>
                <Button className="bg-emerald-500 hover:bg-emerald-600 rounded-sm font-body text-xs" onClick={() => { handleAction(poDetail.po.id, 'approve'); setPoDetail(null); }}>
                  <Check className="w-3 h-3 mr-1" /> Approve
                </Button>
                <Button variant="outline" className="rounded-sm font-body text-xs text-red-600" onClick={() => { handleAction(poDetail.po.id, 'reject'); setPoDetail(null); }}>
                  <X className="w-3 h-3 mr-1" /> Reject
                </Button>
              </>)}
              {poDetail.po.status === 'approved' && poDetail.po.fulfillment_status !== 'received' && (
                <Select value="" onValueChange={v => { handleFulfillment(poDetail.po.id, v); setPoDetail(null); }}>
                  <SelectTrigger className="w-[130px] rounded-sm text-xs"><SelectValue placeholder="Update Status" /></SelectTrigger>
                  <SelectContent><SelectItem value="ordered">Ordered</SelectItem><SelectItem value="received">Received</SelectItem><SelectItem value="verified">Verified</SelectItem></SelectContent>
                </Select>
              )}
            </div>
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
