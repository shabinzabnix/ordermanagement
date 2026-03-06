import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { ArrowLeftRight, Plus, Check, X, Download } from 'lucide-react';
import { downloadExcel } from '../lib/api';

export default function TransfersPage() {
  const [transfers, setTransfers] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ requesting_store_id: '', source_store_id: '', product_id: '', product_name: '', batch: '', quantity: '' });
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const loadTransfers = () => {
    const params = {};
    if (statusFilter !== 'all') params.status = statusFilter;
    api.get('/transfers', { params }).then(r => setTransfers(r.data.transfers)).catch(() => {});
  };
  useEffect(() => { loadTransfers(); }, [statusFilter]);
  useEffect(() => {
    api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {});
    api.get('/products', { params: { limit: 500 } }).then(r => setProducts(r.data.products)).catch(() => {});
  }, []);

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
      setForm({ requesting_store_id: '', source_store_id: '', product_id: '', product_name: '', batch: '', quantity: '' });
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

  return (
    <div data-testid="transfers-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Inter-Store Transfers</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Request and manage stock transfers</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="create-transfer-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Transfer
            </Button>
          </DialogTrigger>
          <Button variant="outline" className="rounded-sm font-body text-xs ml-2" data-testid="export-transfers-btn"
            onClick={() => downloadExcel('/export/transfers', 'transfers.xlsx').catch(() => toast.error('Export failed'))}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
          <DialogContent className="rounded-sm max-w-lg">
            <DialogHeader><DialogTitle className="font-heading">Request Stock Transfer</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Requesting Store *</Label>
                  <Select value={form.requesting_store_id} onValueChange={v => setForm({...form, requesting_store_id: v})}>
                    <SelectTrigger className="rounded-sm" data-testid="transfer-req-store"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Source Store *</Label>
                  <Select value={form.source_store_id} onValueChange={v => setForm({...form, source_store_id: v})}>
                    <SelectTrigger className="rounded-sm" data-testid="transfer-src-store"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="font-body text-xs">Product *</Label>
                <Select value={form.product_id} onValueChange={v => {
                  const p = products.find(p => p.product_id === v);
                  setForm({...form, product_id: v, product_name: p?.product_name || ''});
                }}>
                  <SelectTrigger className="rounded-sm" data-testid="transfer-product"><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>{products.map(p => <SelectItem key={p.product_id} value={p.product_id}>{p.product_name} ({p.product_id})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Batch</Label>
                  <Input data-testid="transfer-batch" value={form.batch} onChange={e => setForm({...form, batch: e.target.value})} className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Quantity *</Label>
                  <Input data-testid="transfer-qty" type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required className="rounded-sm" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="submit-transfer-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>
                  {saving ? 'Creating...' : 'Create Request'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
                {['ID', 'Product', 'From', 'To', 'Qty', 'Status', 'Date', 'Actions'].map(h => (
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
