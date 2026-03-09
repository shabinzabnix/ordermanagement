import { useState, useEffect, useRef, useCallback } from 'react';
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
import { ArrowLeft, Plus, Phone, Pill, Calendar, Clock, Receipt, RefreshCw, StopCircle, User, Edit3, Sun, Moon, Coffee, Search, Loader2 } from 'lucide-react';

function MedicineSearchSelect({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const doSearch = useCallback((q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    api.get(`/products?search=${encodeURIComponent(q)}&limit=20`).then(r => {
      setResults(r.data.products || []);
      setOpen(true);
    }).catch(() => setResults([])).finally(() => setSearching(false));
  }, []);

  const handleInput = (e) => {
    const v = e.target.value;
    setQuery(v);
    onChange(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 300);
  };

  const pick = (p) => {
    const name = p.product_name;
    setQuery(name);
    onChange(name);
    setOpen(false);
  };

  useEffect(() => { if (value && !query) setQuery(value); }, [value, query]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <Input
          data-testid="medicine-search-input"
          value={query}
          onChange={handleInput}
          onFocus={() => { if (results.length) setOpen(true); }}
          placeholder="Search medicine name or ID..."
          className="rounded-sm pl-8 pr-8"
        />
        {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sky-500 animate-spin" />}
      </div>
      {open && results.length > 0 && (
        <div data-testid="medicine-search-results" className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-sm shadow-lg max-h-56 overflow-auto">
          {results.map(p => (
            <button key={p.id} type="button" data-testid={`medicine-option-${p.product_id}`}
              className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
              onClick={() => pick(p)}>
              <span className="text-[13px] font-medium text-slate-800">{p.product_name}</span>
              <span className="text-[10px] text-slate-400 ml-2">ID: {p.product_id}</span>
              {p.category && <span className="text-[10px] text-slate-400 ml-2">| {p.category}</span>}
            </button>
          ))}
        </div>
      )}
      {open && query.length >= 2 && results.length === 0 && !searching && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-sm shadow-lg p-3 text-center">
          <p className="text-[12px] text-slate-400">No products found. You can still type a custom name.</p>
        </div>
      )}
    </div>
  );
}

export default function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [medEditId, setMedEditId] = useState(null);
  const [medEdit, setMedEdit] = useState({ dosage: '', timing: '', food_relation: '', days_of_medication: '' });
  const [pForm, setPForm] = useState({ store_id: '', purchase_date: '' });
  const emptySchedule = { morning: { qty: '', food: '' }, afternoon: { qty: '', food: '' }, night: { qty: '', food: '' } };
  const emptyItem = () => ({ medicine_name: '', days_of_medication: '', schedule: { ...emptySchedule, morning: { ...emptySchedule.morning }, afternoon: { ...emptySchedule.afternoon }, night: { ...emptySchedule.night } } });
  const [pItems, setPItems] = useState([emptyItem()]);
  const [cForm, setCForm] = useState({ call_result: '', remarks: '' });
  const [saving, setSaving] = useState(false);
  const [storeStaff, setStoreStaff] = useState([]);

  const loadProfile = () => { api.get(`/crm/customers/${id}`).then(r => setData(r.data)).catch(() => toast.error('Failed')).finally(() => setLoading(false)); };
  useEffect(() => {
    loadProfile();
    api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {});
    api.get('/crm/store-staff').then(r => setStoreStaff(r.data.staff)).catch(() => {});
  }, [id]);
  useEffect(() => { if (user?.role === 'STORE_STAFF' && user?.store_id) setPForm(f => ({ ...f, store_id: String(user.store_id) })); }, [user]);

  const handleAssignStaff = async (staffId) => {
    try { await api.put(`/crm/customers/${id}/assign-staff`, { staff_id: parseInt(staffId) }); toast.success('Staff assigned'); loadProfile(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const addPItem = () => setPItems([...pItems, emptyItem()]);
  const removePItem = (idx) => { if (pItems.length > 1) setPItems(pItems.filter((_, i) => i !== idx)); };
  const updatePItem = (idx, field, val) => { const copy = [...pItems]; copy[idx] = { ...copy[idx], [field]: val }; setPItems(copy); };
  const updateSchedule = (idx, slot, field, val) => {
    const copy = [...pItems];
    copy[idx] = { ...copy[idx], schedule: { ...copy[idx].schedule, [slot]: { ...copy[idx].schedule[slot], [field]: val } } };
    setPItems(copy);
  };

  const calcDosesPerDay = (schedule) => {
    return (parseFloat(schedule.morning.qty) || 0) + (parseFloat(schedule.afternoon.qty) || 0) + (parseFloat(schedule.night.qty) || 0);
  };
  const calcTotalQty = (item) => {
    const perDay = calcDosesPerDay(item.schedule);
    const days = parseInt(item.days_of_medication) || 0;
    return Math.ceil(perDay * days);
  };
  const buildDosageStr = (schedule) => {
    const parts = [];
    if (parseFloat(schedule.morning.qty) > 0) parts.push(`${schedule.morning.qty} morning${schedule.morning.food ? ' ' + schedule.morning.food.replace('_', ' ') : ''}`);
    if (parseFloat(schedule.afternoon.qty) > 0) parts.push(`${schedule.afternoon.qty} afternoon${schedule.afternoon.food ? ' ' + schedule.afternoon.food.replace('_', ' ') : ''}`);
    if (parseFloat(schedule.night.qty) > 0) parts.push(`${schedule.night.qty} night${schedule.night.food ? ' ' + schedule.night.food.replace('_', ' ') : ''}`);
    return parts.join(', ');
  };
  const buildTimingStr = (schedule) => {
    const parts = [];
    if (parseFloat(schedule.morning.qty) > 0) parts.push('morning');
    if (parseFloat(schedule.afternoon.qty) > 0) parts.push('lunch');
    if (parseFloat(schedule.night.qty) > 0) parts.push('dinner');
    return parts.join(',');
  };
  const buildFoodStr = (schedule) => {
    const foods = new Set();
    ['morning', 'afternoon', 'night'].forEach(s => { if (schedule[s].food && parseFloat(schedule[s].qty) > 0) foods.add(schedule[s].food); });
    return foods.size === 1 ? [...foods][0] : '';
  };

  const handlePurchase = async (e) => {
    e.preventDefault(); setSaving(true);
    let successCount = 0;
    try {
      for (const item of pItems) {
        if (!item.medicine_name) continue;
        const totalQty = calcTotalQty(item);
        const dosageStr = buildDosageStr(item.schedule);
        const timingStr = buildTimingStr(item.schedule);
        const foodStr = buildFoodStr(item.schedule);
        await api.post('/crm/purchases', {
          customer_id: parseInt(id), store_id: parseInt(pForm.store_id), medicine_name: item.medicine_name,
          quantity: totalQty, days_of_medication: parseInt(item.days_of_medication) || 0,
          purchase_date: pForm.purchase_date || undefined,
          dosage: dosageStr || null, timing: timingStr || null, food_relation: foodStr || null,
        });
        successCount++;
      }
      toast.success(`${successCount} medicine(s) recorded`); setPurchaseOpen(false);
      setPForm({ store_id: user?.role === 'STORE_STAFF' ? String(user?.store_id || '') : '', purchase_date: '' });
      setPItems([emptyItem()]);
      loadProfile();
    } catch (err) { toast.error(err.response?.data?.detail || `Failed after ${successCount} items`); } finally { setSaving(false); }
  };

  const handleCall = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await api.post('/crm/calls', { customer_id: parseInt(id), call_result: cForm.call_result, remarks: cForm.remarks }); toast.success('Call logged'); setCallOpen(false); setCForm({ call_result: '', remarks: '' }); loadProfile(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };

  const handleConvertType = async (newType) => {
    try { await api.put(`/crm/customers/${id}/type`, { customer_type: newType }); toast.success(`Customer converted to ${newType}`); loadProfile(); }
    catch { toast.error('Failed'); }
  };

  const handleStopMedicine = async (pid) => { try { await api.put(`/crm/purchases/${pid}/stop`); toast.success('Medicine stopped'); loadProfile(); } catch { toast.error('Failed'); } };

  const handleSaveMedDetails = async () => {
    if (!medEditId) return; setSaving(true);
    try { await api.put(`/crm/purchases/${medEditId}/medication-details`, medEdit); toast.success('Medication details updated'); setMedEditId(null); loadProfile(); }
    catch { toast.error('Failed'); } finally { setSaving(false); }
  };

  if (loading) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-sm" />)}</div>;
  if (!data) return <p className="text-slate-500">Customer not found</p>;
  const c = data.customer;
  const typeBadge = { rc: 'bg-rose-100 text-rose-700', CHRONIC: 'bg-violet-100 text-violet-700', HIGH_VALUE: 'bg-amber-100 text-amber-700', walkin: 'bg-slate-100 text-slate-600', WALKIN: 'bg-slate-100 text-slate-600' };
  const timingIcon = (t) => t === 'morning' ? <Sun className="w-3 h-3 text-amber-500" /> : t === 'lunch' ? <Coffee className="w-3 h-3 text-orange-500" /> : t === 'dinner' ? <Moon className="w-3 h-3 text-indigo-500" /> : null;

  return (
    <div data-testid="customer-profile-page" className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="rounded-sm"><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">{c.customer_name}</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{c.mobile_number} | {c.store_name}</p>
        </div>
        <Badge className={`text-xs rounded-sm px-2.5 py-0.5 font-semibold uppercase ${typeBadge[c.customer_type] || 'bg-slate-100 text-slate-600'}`}>{c.customer_type === 'rc' ? 'RC Customer' : c.customer_type?.replace('_', ' ')}</Badge>
        {c.clv_value > 0 && <Badge className="text-xs rounded-sm bg-emerald-50 text-emerald-700">CLV: INR {c.clv_value.toLocaleString('en-IN')}</Badge>}
        {c.chronic_tags?.map(t => <Badge key={t} className="text-[10px] rounded-sm bg-violet-100 text-violet-700">{t.replace('_', ' ')}</Badge>)}
        {/* Convert to RC */}
        {(c.customer_type === 'walkin' || c.customer_type === 'WALKIN') && (
          <Button size="sm" variant="outline" className="rounded-sm text-xs text-rose-600 border-rose-200 hover:bg-rose-50" onClick={() => handleConvertType('rc')}>
            <RefreshCw className="w-3 h-3 mr-1" /> Convert to RC
          </Button>
        )}
        <Dialog open={callOpen} onOpenChange={setCallOpen}>
          <DialogTrigger asChild><Button variant="outline" className="rounded-sm font-body text-xs"><Phone className="w-3.5 h-3.5 mr-1.5" /> Log Call</Button></DialogTrigger>
          <DialogContent className="rounded-sm"><DialogHeader><DialogTitle className="font-heading">Log CRM Call</DialogTitle></DialogHeader>
            <form onSubmit={handleCall} className="space-y-3">
              <div className="space-y-1.5"><Label className="font-body text-xs">Call Result *</Label>
                <Select value={cForm.call_result} onValueChange={v => setCForm({...cForm, call_result: v})}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent><SelectItem value="reached">Reached</SelectItem><SelectItem value="not_reachable">Not Reachable</SelectItem><SelectItem value="callback">Callback</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="discontinued">Discontinued</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Remarks</Label><Textarea value={cForm.remarks} onChange={e => setCForm({...cForm, remarks: e.target.value})} className="rounded-sm" rows={3} /></div>
              <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving || !cForm.call_result}>{saving ? 'Saving...' : 'Log Call'}</Button></DialogFooter>
            </form></DialogContent>
        </Dialog>
        <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
          <DialogTrigger asChild><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs"><Plus className="w-3.5 h-3.5 mr-1.5" /> Add Medicine</Button></DialogTrigger>
          <DialogContent className="rounded-sm max-w-2xl max-h-[85vh] overflow-auto"><DialogHeader><DialogTitle className="font-heading">Add Medicine / Prescription</DialogTitle></DialogHeader>
            <form onSubmit={handlePurchase} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
                  <Select value={pForm.store_id} onValueChange={v => setPForm({...pForm, store_id: v})} disabled={user?.role === 'STORE_STAFF'}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Purchase Date</Label><Input type="date" value={pForm.purchase_date} onChange={e => setPForm({...pForm, purchase_date: e.target.value})} className="rounded-sm" /></div>
              </div>
              <div className="space-y-3">
                {pItems.map((item, idx) => {
                  const perDay = calcDosesPerDay(item.schedule);
                  const totalQty = calcTotalQty(item);
                  return (
                  <div key={idx} className="p-3 border border-slate-200 rounded-sm space-y-2 relative">
                    {pItems.length > 1 && <button type="button" className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-[10px] font-body" onClick={() => removePItem(idx)}>Remove</button>}
                    <p className="text-[10px] font-body text-slate-400 uppercase tracking-wider">Medicine {idx + 1}</p>
                    <MedicineSearchSelect value={item.medicine_name} onChange={v => updatePItem(idx, 'medicine_name', v)} />
                    <div className="flex gap-3 items-end">
                      <div className="space-y-1 w-[100px]"><Label className="font-body text-[10px]">Days *</Label><Input type="number" value={item.days_of_medication} onChange={e => updatePItem(idx, 'days_of_medication', e.target.value)} required className="rounded-sm h-8 text-sm" /></div>
                      {perDay > 0 && parseInt(item.days_of_medication) > 0 && (
                        <div className="flex-1 text-right">
                          <p className="text-[10px] text-slate-400 font-body">{perDay} nos/day x {item.days_of_medication} days</p>
                          <p className="text-[14px] font-heading font-bold text-sky-700 tabular-nums">{totalQty} nos total</p>
                        </div>
                      )}
                    </div>
                    <div className="bg-slate-50 rounded-sm p-2 space-y-1.5">
                      <p className="text-[9px] font-body text-slate-400 uppercase tracking-wider">Dose Schedule (qty in nos per dose)</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { key: 'morning', label: 'Morning', icon: <Sun className="w-3 h-3 text-amber-500" /> },
                          { key: 'afternoon', label: 'Afternoon', icon: <Coffee className="w-3 h-3 text-orange-500" /> },
                          { key: 'night', label: 'Night', icon: <Moon className="w-3 h-3 text-indigo-500" /> },
                        ].map(slot => (
                          <div key={slot.key} className="space-y-1 p-1.5 bg-white rounded-sm border border-slate-100">
                            <div className="flex items-center gap-1">{slot.icon}<span className="text-[10px] font-body font-medium text-slate-600">{slot.label}</span></div>
                            <Select value={item.schedule[slot.key].qty || 'none'} onValueChange={v => updateSchedule(idx, slot.key, 'qty', v === 'none' ? '' : v)}>
                              <SelectTrigger className="rounded-sm h-7 text-[11px]"><SelectValue placeholder="Qty" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">-</SelectItem>
                                <SelectItem value="0.25">1/4 (Quarter)</SelectItem>
                                <SelectItem value="0.5">1/2 (Half)</SelectItem>
                                <SelectItem value="1">1 (One)</SelectItem>
                                <SelectItem value="1.5">1.5 (One & Half)</SelectItem>
                                <SelectItem value="2">2 (Two)</SelectItem>
                              </SelectContent>
                            </Select>
                            <Select value={item.schedule[slot.key].food || 'none'} onValueChange={v => updateSchedule(idx, slot.key, 'food', v === 'none' ? '' : v)}>
                              <SelectTrigger className="rounded-sm h-7 text-[11px]"><SelectValue placeholder="Food" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">-</SelectItem>
                                <SelectItem value="before_food">Before Food</SelectItem>
                                <SelectItem value="after_food">After Food</SelectItem>
                                <SelectItem value="with_food">With Food</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  );
                })}
                <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs font-body w-full" onClick={addPItem} data-testid="add-another-medicine">
                  <Plus className="w-3 h-3 mr-1" /> Add Another Medicine
                </Button>
              </div>
              <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>{saving ? 'Saving...' : `Record ${pItems.filter(i => i.medicine_name).length} Medicine(s)`}</Button></DialogFooter>
            </form></DialogContent>
        </Dialog>
      </div>

      {/* Staff Assignment (for Store Manager / Admin) */}
      {(c.customer_type === 'rc' || c.customer_type === 'RC' || c.customer_type === 'chronic' || c.customer_type === 'CHRONIC') && (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-sm px-4 py-2.5">
          <User className="w-4 h-4 text-slate-400" />
          <span className="text-[12px] font-body text-slate-600">Assigned Staff:</span>
          {c.assigned_staff_name ? (
            <Badge className="text-[11px] rounded-sm bg-sky-100 text-sky-700 font-medium">{c.assigned_staff_name}</Badge>
          ) : (
            <span className="text-[11px] text-slate-400 italic">Not assigned</span>
          )}
          {['ADMIN', 'HO_STAFF', 'STORE_MANAGER'].includes(user?.role) && storeStaff.length > 0 && (
            <Select value={c.assigned_staff_id ? String(c.assigned_staff_id) : ''} onValueChange={handleAssignStaff}>
              <SelectTrigger className="w-[180px] h-8 rounded-sm text-xs" data-testid="assign-staff-select"><SelectValue placeholder="Assign staff..." /></SelectTrigger>
              <SelectContent>
                {storeStaff.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.role.replace('_', ' ')})</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[{ l: 'Purchases', v: data.total_purchases }, { l: 'Total Spent', v: `INR ${data.total_spent?.toLocaleString('en-IN')}` }, { l: 'Invoices', v: data.total_invoices },
          { l: 'Medicines', v: data.unique_medicines }, { l: 'Repeat', v: data.repeat_count }, { l: 'Calls', v: data.total_calls }].map(k => (
          <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-3">
            <p className="text-[9px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p>
            <p className="text-lg font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.v}</p>
          </CardContent></Card>
        ))}
      </div>

      <Tabs defaultValue="calendar" className="space-y-4">
        <TabsList className="rounded-sm">
          <TabsTrigger value="calendar" className="rounded-sm text-xs font-body">Medicine Calendar ({data.medicine_calendar?.length || 0})</TabsTrigger>
          <TabsTrigger value="purchases" className="rounded-sm text-xs font-body">Purchases ({data.total_invoices})</TabsTrigger>
          <TabsTrigger value="repeat" className="rounded-sm text-xs font-body">Repeat Medicines ({data.repeat_count})</TabsTrigger>
          <TabsTrigger value="callhistory" className="rounded-sm text-xs font-body">Call History ({data.total_calls})</TabsTrigger>
          <TabsTrigger value="timeline" className="rounded-sm text-xs font-body">Timeline</TabsTrigger>
        </TabsList>

        {/* Medicine Calendar with medication details */}
        <TabsContent value="calendar">
          {data.medicine_calendar?.length > 0 ? (
            <div className="space-y-3">
              {data.medicine_calendar.map(m => (
                <Card key={m.id} className={`border-slate-200 rounded-sm overflow-hidden ${m.overdue ? 'border-l-4 border-l-red-400' : m.days_until <= 3 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-emerald-400'}`}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Pill className="w-4 h-4 text-sky-500" />
                        <span className="text-[14px] font-heading font-bold text-slate-900">{m.medicine}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] rounded-sm ${m.overdue ? 'bg-red-100 text-red-700' : m.days_until <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {m.overdue ? `${Math.abs(m.days_until)}d overdue` : `${m.days_until}d left`}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-sky-600" onClick={() => { setMedEditId(m.id); setMedEdit({ dosage: m.dosage || '', timing: m.timing || '', food_relation: m.food_relation || '', days_of_medication: m.days_of_medication || '' }); }}>
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600" onClick={() => handleStopMedicine(m.id)}>
                          <StopCircle className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      {[{ l: 'Qty', v: m.quantity }, { l: 'Duration', v: `${m.days_of_medication}d` }, { l: 'Purchased', v: m.purchase_date ? new Date(m.purchase_date).toLocaleDateString() : '-' },
                        { l: 'Next Due', v: m.next_due_date ? new Date(m.next_due_date).toLocaleDateString() : '-' }, { l: 'Store', v: m.store_name }].map(d => (
                        <div key={d.l}><p className="text-[9px] text-slate-400 uppercase">{d.l}</p><p className="text-[12px] font-semibold text-slate-800">{d.v}</p></div>
                      ))}
                    </div>
                    {/* Medication Details */}
                    <div className="flex items-center gap-3 bg-violet-50/50 rounded-sm px-3 py-1.5">
                      {m.dosage && <span className="text-[11px] font-body"><b className="text-violet-700">Dosage:</b> {m.dosage}</span>}
                      {m.timing && <span className="text-[11px] font-body flex items-center gap-1">{m.timing.split(',').map(t => <span key={t} className="flex items-center gap-0.5">{timingIcon(t.trim())}{t.trim()}</span>)}</span>}
                      {m.food_relation && <Badge className="text-[9px] rounded-sm bg-violet-100 text-violet-700">{m.food_relation.replace('_', ' ')}</Badge>}
                      {!m.dosage && !m.timing && !m.food_relation && <span className="text-[10px] text-slate-400 italic">No medication details set. Click edit to add.</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : <Card className="border-slate-200 rounded-sm"><CardContent className="p-12 text-center"><Calendar className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No active medicines. Click "Add Medicine" to start tracking.</p></CardContent></Card>}
        </TabsContent>

        {/* Purchases */}
        <TabsContent value="purchases">
          {data.invoices?.length > 0 ? data.invoices.map((inv, idx) => (
            <Card key={idx} className="border-slate-200 shadow-sm rounded-sm mb-3">
              <CardHeader className="py-2 px-4"><div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12px] font-body"><Receipt className="w-3.5 h-3.5 text-slate-400" /><span className="font-medium">Invoice: {inv.entry_number || 'N/A'}</span><span className="text-slate-300">|</span><Calendar className="w-3 h-3 text-slate-400" /><span className="text-slate-500">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '-'}</span><span className="text-slate-300">|</span><span className="text-slate-500">{inv.store_name}</span></div>
                <Badge className="text-[11px] rounded-sm bg-emerald-50 text-emerald-700 tabular-nums">INR {inv.total_amount.toLocaleString('en-IN')}</Badge>
              </div></CardHeader>
              <div className="px-4 pb-2"><Table><TableBody>{inv.items.map((item, i) => (
                <TableRow key={i} className="border-b border-slate-50 last:border-0">
                  <TableCell className="py-1.5 font-mono text-[10px] text-slate-400 w-[70px]">{item.product_id || '-'}</TableCell>
                  <TableCell className="py-1.5 font-body text-[12px] text-slate-700">{item.product_name}</TableCell>
                  <TableCell className="py-1.5 text-right text-[12px] tabular-nums w-[90px]">INR {item.amount.toLocaleString('en-IN')}</TableCell>
                </TableRow>))}</TableBody></Table></div>
            </Card>
          )) : <Card className="border-slate-200 rounded-sm"><CardContent className="p-12 text-center"><Receipt className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No purchases</p></CardContent></Card>}
        </TabsContent>

        {/* Repeat */}
        <TabsContent value="repeat">
          <Card className="border-slate-200 shadow-sm rounded-sm"><div className="overflow-auto max-h-[400px]"><Table>
            <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
              {['Medicine', 'Times', 'Total Spent', 'First', 'Last', 'Repeat'].map(h => <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Times', 'Total Spent'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>{data.repeat_medicines?.map((m, i) => (
              <TableRow key={i} className="hover:bg-slate-50/50">
                <TableCell className="font-body text-[13px] font-medium text-slate-800">{m.medicine}</TableCell>
                <TableCell className="text-right text-[12px] tabular-nums font-medium">{m.purchase_count}</TableCell>
                <TableCell className="text-right text-[12px] tabular-nums">INR {m.total_amount.toLocaleString('en-IN')}</TableCell>
                <TableCell className="text-[11px] text-slate-500">{m.first_purchase ? new Date(m.first_purchase).toLocaleDateString() : '-'}</TableCell>
                <TableCell className="text-[11px] text-slate-500">{m.last_purchase ? new Date(m.last_purchase).toLocaleDateString() : '-'}</TableCell>
                <TableCell>{m.is_repeat ? <Badge className="text-[9px] rounded-sm bg-rose-50 text-rose-700"><RefreshCw className="w-2.5 h-2.5 mr-0.5 inline" />Repeat</Badge> : <span className="text-[10px] text-slate-300">Single</span>}</TableCell>
              </TableRow>))}</TableBody>
          </Table></div></Card>
        </TabsContent>

        {/* Call History */}
        <TabsContent value="callhistory">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[400px]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
                  {['Date', 'Called By', 'Result', 'Remarks'].map(h => (
                    <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                  ))}
                </TableRow></TableHeader>
                <TableBody>
                  {!data.call_logs?.length ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-12"><Phone className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No calls logged yet</p></TableCell></TableRow>
                  ) : data.call_logs.map(cl => {
                    const rc = { reached: 'bg-sky-50 text-sky-700', confirmed: 'bg-emerald-50 text-emerald-700', not_reachable: 'bg-red-50 text-red-700', callback: 'bg-amber-50 text-amber-700', discontinued: 'bg-slate-100 text-slate-600' };
                    return (
                      <TableRow key={cl.id} className="hover:bg-slate-50/50">
                        <TableCell className="text-[12px] text-slate-500">{cl.date ? new Date(cl.date).toLocaleString() : '-'}</TableCell>
                        <TableCell className="font-body text-[13px] font-medium text-violet-700">{cl.caller_name}</TableCell>
                        <TableCell><Badge className={`text-[10px] rounded-sm ${rc[cl.call_result] || 'bg-slate-100 text-slate-600'}`}>{cl.call_result?.replace('_', ' ')}</Badge></TableCell>
                        <TableCell className="text-[12px] text-slate-600 max-w-[300px]">{cl.remarks || '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Timeline */}
        <TabsContent value="timeline">
          <Card className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-4"><div className="space-y-0 max-h-[400px] overflow-auto">
            {data.timeline?.length > 0 ? data.timeline.map((t, i) => (
              <div key={i} className="flex gap-3 py-2.5 border-b border-slate-100 last:border-0">
                <div className={`mt-0.5 p-1.5 rounded-full shrink-0 ${t.type === 'purchase' ? 'bg-emerald-50' : t.type === 'call' ? 'bg-violet-50' : 'bg-sky-50'}`}>
                  {t.type === 'purchase' ? <Receipt className="w-3 h-3 text-emerald-600" /> : t.type === 'call' ? <Phone className="w-3 h-3 text-violet-600" /> : <Calendar className="w-3 h-3 text-sky-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-body font-medium text-slate-800">{t.title}</p>
                  <p className="text-[11px] font-body text-slate-400 mt-0.5">{t.subtitle}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {t.caller && <span className="text-[10px] font-body text-violet-500 font-medium">By: {t.caller}</span>}
                    <span className="text-[10px] font-body text-slate-300">{t.date ? new Date(t.date).toLocaleString() : ''}</span>
                  </div>
                </div>
              </div>
            )) : <div className="text-center py-10"><Clock className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400">No activity</p></div>}
          </div></CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Edit Medication Details Dialog */}
      <Dialog open={medEditId !== null} onOpenChange={v => { if (!v) setMedEditId(null); }}>
        <DialogContent className="rounded-sm max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Edit Medication Details</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label className="font-body text-xs">Dosage</Label><Input value={medEdit.dosage} onChange={e => setMedEdit({...medEdit, dosage: e.target.value})} className="rounded-sm" placeholder="e.g. 1 tablet, 5ml" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="font-body text-xs">Timing</Label>
                <Select value={medEdit.timing || 'none'} onValueChange={v => setMedEdit({...medEdit, timing: v === 'none' ? '' : v})}><SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">-</SelectItem><SelectItem value="morning">Morning</SelectItem><SelectItem value="lunch">Afternoon</SelectItem><SelectItem value="dinner">Night</SelectItem><SelectItem value="morning,dinner">Morning + Night</SelectItem><SelectItem value="morning,lunch,dinner">Morning + Afternoon + Night</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Food Relation</Label>
                <Select value={medEdit.food_relation || 'none'} onValueChange={v => setMedEdit({...medEdit, food_relation: v === 'none' ? '' : v})}><SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">-</SelectItem><SelectItem value="before_food">Before Food</SelectItem><SelectItem value="after_food">After Food</SelectItem><SelectItem value="with_food">With Food</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-1.5"><Label className="font-body text-xs">Days of Medication</Label><Input type="number" value={medEdit.days_of_medication} onChange={e => setMedEdit({...medEdit, days_of_medication: e.target.value})} className="rounded-sm" placeholder="Updates next due date" /></div>
          </div>
          <DialogFooter><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={handleSaveMedDetails} disabled={saving}>{saving ? 'Saving...' : 'Save Details'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
