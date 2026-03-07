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
import { toast } from 'sonner';
import { ArrowLeftRight, Plus, Check, X, Download, Search, Warehouse } from 'lucide-react';
import { downloadExcel } from '../lib/api';

export default function TransfersPage() {
  const { user } = useAuth();
  const [transfers, setTransfers] = useState([]);
  const [stores, setStores] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ requesting_store_id: '', source_store_id: '', product_id: '', product_name: '', batch: '', quantity: '' });
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  // Product search
  const [productSearch, setProductSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Network stock after product selected
  const [networkStock, setNetworkStock] = useState(null);
  const [step, setStep] = useState(1); // 1=select product, 2=see stock & submit

  const loadTransfers = () => {
    const params = {};
    if (statusFilter !== 'all') params.status = statusFilter;
    api.get('/transfers', { params }).then(r => setTransfers(r.data.transfers)).catch(() => {});
  };
  useEffect(() => { loadTransfers(); }, [statusFilter]);
  useEffect(() => {
    api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {});
  }, []);
  useEffect(() => {
    if (user?.role === 'STORE_STAFF' && user?.store_id) setForm(f => ({ ...f, requesting_store_id: String(user.store_id) }));
  }, [user]);

  // Product search debounce
  useEffect(() => {
    if (productSearch.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      api.get('/products', { params: { search: productSearch, limit: 15 } })
        .then(r => { setSuggestions(r.data.products); setShowSuggestions(true); }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);

  // Load network stock when product selected
  const loadNetworkStock = async (productId) => {
    try {
      const res = await api.get(`/stock/availability/${productId}`);
      // Filter out Head Office stock - only show store stock for inter-store transfers
      setNetworkStock((res.data.availability || []).filter(s => s.store_id));
    } catch { setNetworkStock([]); }
  };

  const selectProduct = (p) => {
    setForm({ ...form, product_id: p.product_id, product_name: p.product_name });
    setProductSearch(p.product_name);
    setShowSuggestions(false);
    loadNetworkStock(p.product_id);
    setStep(2);
  };

  const resetForm = () => {
    setForm({ requesting_store_id: user?.role === 'STORE_STAFF' ? String(user?.store_id || '') : '', source_store_id: '', product_id: '', product_name: '', batch: '', quantity: '' });
    setProductSearch('');
    setNetworkStock(null);
    setStep(1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/transfers', {
        ...form,
        requesting_store_id: parseInt(form.requesting_store_id),
        source_store_id: parseInt(form.source_store_id),
        quantity: parseFloat(form.quantity),
      });
      toast.success('Transfer request created');
      setOpen(false);
      resetForm();
      loadTransfers();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAction = async (id, action) => {
    try {
      if (action === 'approve') await api.put(`/transfers/${id}/approve`);
      else await api.put(`/transfers/${id}/reject`, { rejection_reason: 'Rejected by staff' });
      toast.success(`Transfer ${action}d`);
      loadTransfers();
    } catch (err) { toast.error(err.response?.data?.detail || 'Action failed'); }
  };

  const statusColor = (s) => {
    if (s === 'approved') return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50';
    if (s === 'rejected') return 'bg-red-50 text-red-700 hover:bg-red-50';
    return 'bg-amber-50 text-amber-700 hover:bg-amber-50';
  };

  // Get source stores that have stock for selected product
  const storesWithStock = networkStock ? [...new Map(networkStock.filter(n => n.store_id).map(n => [n.store_id, n])).values()] : [];
  const selectedSourceStock = networkStock?.filter(n => String(n.store_id) === form.source_store_id) || [];
  const maxQty = selectedSourceStock.reduce((sum, s) => sum + (s.stock || 0), 0);
  const qtyExceeds = form.quantity && maxQty > 0 && parseFloat(form.quantity) > maxQty;

  return (
    <div data-testid="transfers-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Inter-Store Transfers</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Request and manage stock transfers</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="create-transfer-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs">
                <Plus className="w-3.5 h-3.5 mr-1.5" /> New Transfer
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-sm max-w-xl">
              <DialogHeader><DialogTitle className="font-heading">Request Stock Transfer</DialogTitle></DialogHeader>

              {/* Step 1: Select Product */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs font-medium">Step 1: Select Product</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <Input placeholder="Search product by name or ID..." value={productSearch}
                      onChange={e => { setProductSearch(e.target.value); if (!e.target.value) { resetForm(); } }}
                      className="rounded-sm pl-9 font-body" autoComplete="off" data-testid="transfer-product-search" />
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-[200px] overflow-auto">
                        {suggestions.map(p => (
                          <button key={p.product_id} type="button" className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
                            onClick={() => selectProduct(p)}>
                            <p className="text-[13px] font-body font-medium text-slate-800">{p.product_name}</p>
                            <p className="text-[10px] font-mono text-slate-400">{p.product_id} | MRP: {p.mrp}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {form.product_id && <p className="text-[10px] font-body text-emerald-600">Selected: {form.product_name} ({form.product_id})</p>}
                </div>

                {/* Step 2: Network Stock Display */}
                {step >= 2 && networkStock !== null && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="font-body text-xs font-medium flex items-center gap-1.5">
                        <Warehouse className="w-3.5 h-3.5 text-sky-500" /> Step 2: Stock Availability Across Network
                      </Label>
                      <Card className="border-slate-200 rounded-sm">
                        <div className="max-h-[180px] overflow-auto">
                          {networkStock.length === 0 ? (
                            <div className="p-4 text-center text-[12px] text-red-500 font-body">No stock available for this product in any location</div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow className="border-b border-slate-100">
                                  {['Location', 'Batch', 'Stock', 'MRP'].map(h => (
                                    <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 font-body py-2 ${['Stock', 'MRP'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {networkStock.map((s, i) => (
                                  <TableRow key={i} className="hover:bg-sky-50/50">
                                    <TableCell className="text-[12px] font-body font-medium text-slate-700 py-1.5">{s.location}</TableCell>
                                    <TableCell className="font-mono text-[10px] text-slate-500">{s.batch}</TableCell>
                                    <TableCell className="text-right text-[12px] tabular-nums font-medium text-emerald-700">{s.stock}</TableCell>
                                    <TableCell className="text-right text-[11px] tabular-nums text-slate-500">{s.mrp}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      </Card>
                    </div>

                    {/* Step 3: Submit Transfer */}
                    {networkStock.length > 0 && (
                      <form onSubmit={handleSubmit} className="space-y-3">
                        <Label className="font-body text-xs font-medium">Step 3: Request Transfer</Label>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="font-body text-[10px] text-slate-500">Requesting Store *</Label>
                            <Select value={form.requesting_store_id} onValueChange={v => setForm({...form, requesting_store_id: v})} disabled={user?.role === 'STORE_STAFF'}>
                              <SelectTrigger className="rounded-sm text-sm"><SelectValue placeholder="Your store" /></SelectTrigger>
                              <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="font-body text-[10px] text-slate-500">Source Store * <span className="text-emerald-600">(has stock)</span></Label>
                            <Select value={form.source_store_id} onValueChange={v => setForm({...form, source_store_id: v})}>
                              <SelectTrigger className="rounded-sm text-sm"><SelectValue placeholder="Select source" /></SelectTrigger>
                              <SelectContent>
                                {storesWithStock.map(s => (
                                  <SelectItem key={s.store_id} value={String(s.store_id)}>{s.location} ({s.stock} units)</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="font-body text-[10px] text-slate-500">Batch</Label>
                            <Input value={form.batch} onChange={e => setForm({...form, batch: e.target.value})} className="rounded-sm" placeholder="Optional" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="font-body text-[10px] text-slate-500">Quantity * <span className="text-slate-400">(1 - {maxQty})</span></Label>
                            <Input type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required
                              min={1} max={maxQty}
                              className={`rounded-sm ${qtyExceeds ? 'border-red-400 ring-1 ring-red-200' : ''}`} />
                            {qtyExceeds && <p className="text-[10px] text-red-600">Exceeds available stock ({maxQty} max)</p>}
                            {form.quantity && parseFloat(form.quantity) < 1 && <p className="text-[10px] text-red-600">Minimum quantity is 1</p>}
                          </div>
                        </div>
                        {/* Transfer Value */}
                        {form.quantity && parseFloat(form.quantity) >= 1 && selectedSourceStock.length > 0 && (
                          <div className="bg-sky-50 border border-sky-200 rounded-sm p-3 flex items-center justify-between">
                            <span className="text-[12px] font-body text-sky-800">Transfer Value ({form.quantity} units x MRP {selectedSourceStock[0]?.mrp || 0})</span>
                            <span className="text-lg font-heading font-bold text-sky-700 tabular-nums">INR {(parseFloat(form.quantity) * (selectedSourceStock[0]?.mrp || 0)).toLocaleString('en-IN')}</span>
                          </div>
                        )}
                        <DialogFooter>
                          <Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs"
                            disabled={saving || !form.source_store_id || !form.requesting_store_id || !form.quantity || qtyExceeds || parseFloat(form.quantity) < 1}>
                            {saving ? 'Creating...' : 'Submit Transfer Request'}
                          </Button>
                        </DialogFooter>
                      </form>
                    )}
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" className="rounded-sm font-body text-xs" data-testid="export-transfers-btn"
            onClick={() => downloadExcel('/export/transfers', 'transfers.xlsx').catch(() => toast.error('Export failed'))}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {['all', 'pending', 'approved', 'rejected'].map(s => (
          <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm"
            onClick={() => setStatusFilter(s)} className={`rounded-sm font-body text-xs capitalize ${statusFilter === s ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
            data-testid={`filter-${s}`}>{s}</Button>
        ))}
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-320px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['ID', 'Product', 'From', 'To', 'Qty', 'Status', 'Requested By', 'Date', 'Actions'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16">
                  <ArrowLeftRight className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No transfers found</p>
                </TableCell></TableRow>
              ) : transfers.map(t => (
                <TableRow key={t.id} className="hover:bg-slate-50/50" data-testid={`transfer-row-${t.id}`}>
                  <TableCell className="font-mono text-[11px] text-slate-500">#{t.id}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{t.product_name}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{t.source_store_name}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{t.requesting_store_name}</TableCell>
                  <TableCell className="text-[12px] tabular-nums">{t.quantity}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${statusColor(t.status)}`}>{t.status}</Badge></TableCell>
                  <TableCell className="text-[11px] font-body text-slate-600">{t.requested_by || '-'}</TableCell>
                  <TableCell className="text-[11px] text-slate-400">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>
                    {t.status === 'pending' && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-6 w-6 p-0 rounded-sm text-emerald-600 hover:bg-emerald-50"
                          onClick={() => handleAction(t.id, 'approve')} data-testid={`approve-${t.id}`}><Check className="w-3 h-3" /></Button>
                        <Button size="sm" variant="outline" className="h-6 w-6 p-0 rounded-sm text-red-600 hover:bg-red-50"
                          onClick={() => handleAction(t.id, 'reject')} data-testid={`reject-${t.id}`}><X className="w-3 h-3" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
