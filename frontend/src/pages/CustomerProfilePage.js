import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import {
  ArrowLeft, Plus, Phone, Pill, Calendar, Clock,
  AlertTriangle, CheckCircle, StopCircle, UserCircle,
} from 'lucide-react';

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
  useEffect(() => {
    if (user?.role === 'store_staff' && user?.store_id && !pForm.store_id) setPForm(f => ({ ...f, store_id: String(user.store_id) }));
  }, [user]);

  const handlePurchase = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/crm/purchases', { customer_id: parseInt(id), store_id: parseInt(pForm.store_id), medicine_name: pForm.medicine_name,
        quantity: parseFloat(pForm.quantity) || 0, days_of_medication: parseInt(pForm.days_of_medication) || 0, purchase_date: pForm.purchase_date || undefined });
      toast.success('Purchase recorded'); setPurchaseOpen(false);
      setPForm({ store_id: user?.role === 'store_staff' ? String(user?.store_id || '') : '', medicine_name: '', quantity: '', days_of_medication: '', purchase_date: '' });
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
    try { await api.put(`/crm/purchases/${purchaseId}/stop`); toast.success('Medicine stopped'); loadProfile(); }
    catch { toast.error('Failed'); }
  };

  if (loading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-sm" />)}</div>;
  if (!data) return <p className="text-slate-500">Customer not found</p>;

  const c = data.customer;
  const typeBadge = { rc: 'bg-rose-50 text-rose-700', chronic: 'bg-violet-50 text-violet-700', high_value: 'bg-amber-50 text-amber-700', walkin: 'bg-slate-100 text-slate-600' };

  return (
    <div data-testid="customer-profile-page" className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/crm')} className="rounded-sm" data-testid="back-to-crm"><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">{c.customer_name}</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{c.mobile_number} | {c.store_name}</p>
        </div>
        <Badge className={`text-xs rounded-sm ${typeBadge[c.customer_type] || 'bg-slate-100 text-slate-600'}`}>{c.customer_type?.replace('_', ' ')}</Badge>
        <Dialog open={callOpen} onOpenChange={setCallOpen}>
          <DialogTrigger asChild><Button variant="outline" className="rounded-sm font-body text-xs" data-testid="log-call-btn"><Phone className="w-3.5 h-3.5 mr-1.5" /> Log Call</Button></DialogTrigger>
          <DialogContent className="rounded-sm"><DialogHeader><DialogTitle className="font-heading">Log CRM Call</DialogTitle></DialogHeader>
            <form onSubmit={handleCall} className="space-y-3">
              <div className="space-y-1.5"><Label className="font-body text-xs">Call Result *</Label>
                <Select value={cForm.call_result} onValueChange={v => setCForm({...cForm, call_result: v})}>
                  <SelectTrigger className="rounded-sm" data-testid="call-result-select"><SelectValue placeholder="Select result" /></SelectTrigger>
                  <SelectContent><SelectItem value="reached">Reached</SelectItem><SelectItem value="not_reachable">Not Reachable</SelectItem><SelectItem value="callback">Call Back Later</SelectItem><SelectItem value="confirmed">Confirmed Purchase</SelectItem><SelectItem value="discontinued">Discontinued</SelectItem></SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Remarks</Label>
                <Textarea data-testid="call-remarks" value={cForm.remarks} onChange={e => setCForm({...cForm, remarks: e.target.value})} className="rounded-sm" rows={3} /></div>
              <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving || !cForm.call_result} data-testid="save-call-btn">{saving ? 'Saving...' : 'Log Call'}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
          <DialogTrigger asChild><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" data-testid="add-purchase-btn"><Plus className="w-3.5 h-3.5 mr-1.5" /> Add Purchase</Button></DialogTrigger>
          <DialogContent className="rounded-sm"><DialogHeader><DialogTitle className="font-heading">Record Medicine Purchase</DialogTitle></DialogHeader>
            <form onSubmit={handlePurchase} className="space-y-3">
              <div className="space-y-1.5"><Label className="font-body text-xs">Medicine Name *</Label>
                <Input data-testid="purchase-medicine" value={pForm.medicine_name} onChange={e => setPForm({...pForm, medicine_name: e.target.value})} required className="rounded-sm" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label className="font-body text-xs">Quantity</Label>
                  <Input data-testid="purchase-qty" type="number" value={pForm.quantity} onChange={e => setPForm({...pForm, quantity: e.target.value})} className="rounded-sm" /></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Days of Medication *</Label>
                  <Input data-testid="purchase-days" type="number" value={pForm.days_of_medication} onChange={e => setPForm({...pForm, days_of_medication: e.target.value})} required className="rounded-sm" /></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Purchase Date</Label>
                  <Input data-testid="purchase-date" type="date" value={pForm.purchase_date} onChange={e => setPForm({...pForm, purchase_date: e.target.value})} className="rounded-sm" /></div>
              </div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
                <Select value={pForm.store_id} onValueChange={v => setPForm({...pForm, store_id: v})} disabled={user?.role === 'store_staff'}>
                  <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                </Select></div>
              <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving} data-testid="save-purchase-btn">{saving ? 'Saving...' : 'Record Purchase'}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[{ l: 'Total Purchases', v: data.total_purchases }, { l: 'Active Medicines', v: data.medicine_calendar?.length || 0 }, { l: 'Total Calls', v: data.total_calls }, { l: 'Pending Tasks', v: data.tasks?.filter(t => t.status === 'pending').length || 0 }].map(k => (
          <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-4">
            <p className="text-[10px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p>
            <p className="text-xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.v}</p>
          </CardContent></Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Medicine Calendar */}
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Calendar className="w-4 h-4 text-sky-500" /> Medicine Calendar</CardTitle></CardHeader>
          <CardContent>
            {data.medicine_calendar?.length > 0 ? (
              <div className="space-y-3">
                {data.medicine_calendar.map(m => (
                  <div key={m.id} className={`p-3 rounded-sm border ${m.overdue ? 'border-red-200 bg-red-50/30' : m.days_until <= 3 ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[13px] font-body font-medium text-slate-800 flex items-center gap-1.5"><Pill className="w-3.5 h-3.5 text-sky-500" /> {m.medicine}</p>
                        <p className="text-[11px] font-body text-slate-500 mt-1">Qty: {m.quantity} | {m.days_of_medication} days | {m.store_name}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] font-body">
                          <span className="text-slate-400">Purchased: {m.purchase_date ? new Date(m.purchase_date).toLocaleDateString() : '-'}</span>
                          <span className={m.overdue ? 'text-red-600 font-medium' : 'text-slate-600'}>Due: {m.next_due_date ? new Date(m.next_due_date).toLocaleDateString() : '-'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] rounded-sm ${m.overdue ? 'bg-red-100 text-red-700' : m.days_until <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {m.overdue ? `${Math.abs(m.days_until)}d overdue` : `${m.days_until}d left`}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600" onClick={() => handleStopMedicine(m.id)} data-testid={`stop-medicine-${m.id}`}>
                          <StopCircle className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="text-center py-8"><Calendar className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400 font-body">No active medicines</p></div>}
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400" /> Timeline</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-0 max-h-[400px] overflow-auto">
              {data.timeline?.length > 0 ? data.timeline.map((t, i) => (
                <div key={i} className="flex gap-3 py-2.5 border-b border-slate-100 last:border-0">
                  <div className={`mt-0.5 p-1.5 rounded-full shrink-0 ${t.type === 'purchase' ? 'bg-emerald-50' : 'bg-violet-50'}`}>
                    {t.type === 'purchase' ? <Pill className="w-3 h-3 text-emerald-600" /> : <Phone className="w-3 h-3 text-violet-600" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-body font-medium text-slate-800">{t.title}</p>
                    <p className="text-[11px] font-body text-slate-400 mt-0.5">{t.subtitle}</p>
                    <p className="text-[10px] font-body text-slate-300 mt-0.5">{t.date ? new Date(t.date).toLocaleString() : ''}</p>
                  </div>
                </div>
              )) : <div className="text-center py-8"><Clock className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400 font-body">No activity yet</p></div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
