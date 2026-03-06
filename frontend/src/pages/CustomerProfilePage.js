import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Plus, Phone, Pill, Calendar, Clock, Receipt, RefreshCw, StopCircle, User, IndianRupee } from 'lucide-react';

export default function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [pForm, setPForm] = useState({ store_id: '', medicine_name: '', quantity: '', days_of_medication: '', purchase_date: '' });
  const [cForm, setCForm] = useState({ call_result: '', remarks: '' });
  const [saving, setSaving] = useState(false);

  const loadProfile = () => {
    api.get(`/crm/customers/${id}`).then(r => setData(r.data)).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  };
  useEffect(() => { loadProfile(); api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, [id]);
  useEffect(() => { if (user?.role === 'STORE_STAFF' && user?.store_id && !pForm.store_id) setPForm(f => ({ ...f, store_id: String(user.store_id) })); }, [user]);

  const handlePurchase = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/crm/purchases', { customer_id: parseInt(id), store_id: parseInt(pForm.store_id), medicine_name: pForm.medicine_name,
        quantity: parseFloat(pForm.quantity) || 0, days_of_medication: parseInt(pForm.days_of_medication) || 0, purchase_date: pForm.purchase_date || undefined });
      toast.success('Purchase recorded'); setPurchaseOpen(false);
      setPForm({ store_id: user?.role === 'STORE_STAFF' ? String(user?.store_id || '') : '', medicine_name: '', quantity: '', days_of_medication: '', purchase_date: '' });
      loadProfile();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };

  const handleCall = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/crm/calls', { customer_id: parseInt(id), call_result: cForm.call_result, remarks: cForm.remarks });
      toast.success('Call logged'); setCallOpen(false); setCForm({ call_result: '', remarks: '' }); loadProfile();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };

  const handleStopMedicine = async (purchaseId) => {
    try { await api.put(`/crm/purchases/${purchaseId}/stop`); toast.success('Medicine stopped'); loadProfile(); } catch { toast.error('Failed'); }
  };

  if (loading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-sm" />)}</div>;
  if (!data) return <p className="text-slate-500">Customer not found</p>;

  const c = data.customer;
  const typeBadge = { rc: 'bg-rose-50 text-rose-700', CHRONIC: 'bg-violet-50 text-violet-700', HIGH_VALUE: 'bg-amber-50 text-amber-700', walkin: 'bg-slate-100 text-slate-600', WALKIN: 'bg-slate-100 text-slate-600' };

  return (
    <div data-testid="customer-profile-page" className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="rounded-sm"><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">{c.customer_name}</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{c.mobile_number} | {c.store_name}</p>
        </div>
        <Badge className={`text-xs rounded-sm ${typeBadge[c.customer_type] || 'bg-slate-100 text-slate-600'}`}>{c.customer_type?.replace('_', ' ')}</Badge>
        {c.clv_value > 0 && <Badge className="text-xs rounded-sm bg-emerald-50 text-emerald-700">CLV: INR {c.clv_value.toLocaleString('en-IN')}</Badge>}
        {c.chronic_tags?.map(t => <Badge key={t} className="text-[10px] rounded-sm bg-violet-100 text-violet-700">{t.replace('_', ' ')}</Badge>)}
        <Dialog open={callOpen} onOpenChange={setCallOpen}>
          <DialogTrigger asChild><Button variant="outline" className="rounded-sm font-body text-xs"><Phone className="w-3.5 h-3.5 mr-1.5" /> Log Call</Button></DialogTrigger>
          <DialogContent className="rounded-sm"><DialogHeader><DialogTitle className="font-heading">Log CRM Call</DialogTitle></DialogHeader>
            <form onSubmit={handleCall} className="space-y-3">
              <div className="space-y-1.5"><Label className="font-body text-xs">Call Result *</Label>
                <Select value={cForm.call_result} onValueChange={v => setCForm({...cForm, call_result: v})}>
                  <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select result" /></SelectTrigger>
                  <SelectContent><SelectItem value="reached">Reached</SelectItem><SelectItem value="not_reachable">Not Reachable</SelectItem><SelectItem value="callback">Call Back Later</SelectItem><SelectItem value="confirmed">Confirmed Purchase</SelectItem><SelectItem value="discontinued">Discontinued</SelectItem></SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Remarks</Label><Textarea value={cForm.remarks} onChange={e => setCForm({...cForm, remarks: e.target.value})} className="rounded-sm" rows={3} /></div>
              <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving || !cForm.call_result}>{saving ? 'Saving...' : 'Log Call'}</Button></DialogFooter>
            </form></DialogContent>
        </Dialog>
        <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
          <DialogTrigger asChild><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs"><Plus className="w-3.5 h-3.5 mr-1.5" /> Add Purchase</Button></DialogTrigger>
          <DialogContent className="rounded-sm"><DialogHeader><DialogTitle className="font-heading">Record Medicine Purchase</DialogTitle></DialogHeader>
            <form onSubmit={handlePurchase} className="space-y-3">
              <div className="space-y-1.5"><Label className="font-body text-xs">Medicine Name *</Label><Input value={pForm.medicine_name} onChange={e => setPForm({...pForm, medicine_name: e.target.value})} required className="rounded-sm" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label className="font-body text-xs">Quantity</Label><Input type="number" value={pForm.quantity} onChange={e => setPForm({...pForm, quantity: e.target.value})} className="rounded-sm" /></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Days *</Label><Input type="number" value={pForm.days_of_medication} onChange={e => setPForm({...pForm, days_of_medication: e.target.value})} required className="rounded-sm" /></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Date</Label><Input type="date" value={pForm.purchase_date} onChange={e => setPForm({...pForm, purchase_date: e.target.value})} className="rounded-sm" /></div>
              </div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
                <Select value={pForm.store_id} onValueChange={v => setPForm({...pForm, store_id: v})} disabled={user?.role === 'STORE_STAFF'}>
                  <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                </Select></div>
              <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>{saving ? 'Saving...' : 'Record'}</Button></DialogFooter>
            </form></DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { l: 'Total Purchases', v: data.total_purchases },
          { l: 'Total Spent', v: `INR ${data.total_spent?.toLocaleString('en-IN')}` },
          { l: 'Invoices', v: data.total_invoices },
          { l: 'Unique Medicines', v: data.unique_medicines },
          { l: 'Repeat Medicines', v: data.repeat_count },
          { l: 'CRM Calls', v: data.total_calls },
        ].map(k => (
          <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-3">
            <p className="text-[9px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p>
            <p className="text-lg font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.v}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* Tabs: Purchases | Repeat Medicines | Medicine Calendar | Timeline */}
      <Tabs defaultValue="purchases" className="space-y-4">
        <TabsList className="rounded-sm">
          <TabsTrigger value="purchases" className="rounded-sm text-xs font-body">Purchase History ({data.total_invoices})</TabsTrigger>
          <TabsTrigger value="repeat" className="rounded-sm text-xs font-body">Repeat Medicines ({data.repeat_count})</TabsTrigger>
          <TabsTrigger value="calendar" className="rounded-sm text-xs font-body">Medicine Calendar ({data.medicine_calendar?.length || 0})</TabsTrigger>
          <TabsTrigger value="timeline" className="rounded-sm text-xs font-body">Timeline</TabsTrigger>
        </TabsList>

        {/* Purchase History - Invoice wise */}
        <TabsContent value="purchases">
          {data.invoices?.length > 0 ? data.invoices.map((inv, idx) => (
            <Card key={idx} className="border-slate-200 shadow-sm rounded-sm mb-3">
              <CardHeader className="py-2 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[12px] font-body">
                    <Receipt className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-medium text-slate-700">Invoice: {inv.entry_number || 'N/A'}</span>
                    <span className="text-slate-300">|</span>
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span className="text-slate-500">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '-'}</span>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-500">{inv.store_name}</span>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-500">{inv.item_count} items</span>
                  </div>
                  <Badge className="text-[11px] rounded-sm bg-emerald-50 text-emerald-700 font-medium tabular-nums">INR {inv.total_amount.toLocaleString('en-IN')}</Badge>
                </div>
              </CardHeader>
              <div className="px-4 pb-2">
                <Table><TableBody>
                  {inv.items.map((item, i) => (
                    <TableRow key={i} className="border-b border-slate-50 last:border-0">
                      <TableCell className="py-1.5 font-mono text-[10px] text-slate-400 w-[70px]">{item.product_id || '-'}</TableCell>
                      <TableCell className="py-1.5 font-body text-[12px] text-slate-700">{item.product_name}</TableCell>
                      <TableCell className="py-1.5 text-right text-[12px] tabular-nums w-[90px]">INR {item.amount.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="py-1.5 text-right w-[60px]">{item.days_of_medication ? <Badge className="text-[9px] rounded-sm bg-sky-50 text-sky-700">{item.days_of_medication}d</Badge> : ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table>
              </div>
            </Card>
          )) : <Card className="border-slate-200 rounded-sm"><CardContent className="p-12 text-center"><Receipt className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No purchase records</p></CardContent></Card>}
        </TabsContent>

        {/* Repeat Medicines */}
        <TabsContent value="repeat">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[400px]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Medicine', 'Product ID', 'Times Purchased', 'Total Spent', 'First Purchase', 'Last Purchase', 'Repeat'].map(h => (
                      <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Times Purchased', 'Total Spent'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.repeat_medicines?.length > 0 ? data.repeat_medicines.map((m, i) => (
                    <TableRow key={i} className="hover:bg-slate-50/50">
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{m.medicine}</TableCell>
                      <TableCell className="font-mono text-[10px] text-slate-400">{m.product_id || '-'}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums font-medium">{m.purchase_count}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">INR {m.total_amount.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{m.first_purchase ? new Date(m.first_purchase).toLocaleDateString() : '-'}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{m.last_purchase ? new Date(m.last_purchase).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{m.is_repeat ? <Badge className="text-[9px] rounded-sm bg-rose-50 text-rose-700"><RefreshCw className="w-2.5 h-2.5 mr-0.5 inline" />Repeat</Badge> : <span className="text-[10px] text-slate-300">Single</span>}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={7} className="text-center py-12"><Pill className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400 font-body">No medicine data</p></TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Medicine Calendar */}
        <TabsContent value="calendar">
          {data.medicine_calendar?.length > 0 ? (
            <div className="space-y-3">
              {data.medicine_calendar.map(m => (
                <Card key={m.id} className={`border-slate-200 rounded-sm ${m.overdue ? 'border-l-4 border-l-red-400' : m.days_until <= 3 ? 'border-l-4 border-l-amber-400' : ''}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-body font-medium text-slate-800 flex items-center gap-1.5"><Pill className="w-3.5 h-3.5 text-sky-500" /> {m.medicine}</p>
                      <p className="text-[11px] font-body text-slate-500 mt-1">Qty: {m.quantity} | {m.days_of_medication} days | {m.store_name}</p>
                      <p className="text-[10px] font-body text-slate-400 mt-0.5">Purchased: {m.purchase_date ? new Date(m.purchase_date).toLocaleDateString() : '-'} | Due: {m.next_due_date ? new Date(m.next_due_date).toLocaleDateString() : '-'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] rounded-sm ${m.overdue ? 'bg-red-100 text-red-700' : m.days_until <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {m.overdue ? `${Math.abs(m.days_until)}d overdue` : `${m.days_until}d left`}
                      </Badge>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600" onClick={() => handleStopMedicine(m.id)}><StopCircle className="w-3.5 h-3.5" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : <Card className="border-slate-200 rounded-sm"><CardContent className="p-12 text-center"><Calendar className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No active medicine tracking. Add a purchase with medication days to start.</p></CardContent></Card>}
        </TabsContent>

        {/* Timeline */}
        <TabsContent value="timeline">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-4">
              <div className="space-y-0 max-h-[400px] overflow-auto">
                {data.timeline?.length > 0 ? data.timeline.map((t, i) => (
                  <div key={i} className="flex gap-3 py-2.5 border-b border-slate-100 last:border-0">
                    <div className={`mt-0.5 p-1.5 rounded-full shrink-0 ${t.type === 'purchase' ? 'bg-emerald-50' : t.type === 'call' ? 'bg-violet-50' : 'bg-sky-50'}`}>
                      {t.type === 'purchase' ? <Receipt className="w-3 h-3 text-emerald-600" /> : t.type === 'call' ? <Phone className="w-3 h-3 text-violet-600" /> : <Calendar className="w-3 h-3 text-sky-600" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-body font-medium text-slate-800">{t.title}</p>
                      <p className="text-[11px] font-body text-slate-400 mt-0.5">{t.subtitle}</p>
                      <p className="text-[10px] font-body text-slate-300 mt-0.5">{t.date ? new Date(t.date).toLocaleString() : ''}</p>
                    </div>
                  </div>
                )) : <div className="text-center py-10"><Clock className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400 font-body">No activity yet</p></div>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
