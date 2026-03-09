import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { toast } from 'sonner';
import { Phone, CheckCircle, ChevronLeft, ChevronRight, Pill, Clock, User, IndianRupee, Edit3, Receipt, Save } from 'lucide-react';

export default function SalesCallTasksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [salesDate, setSalesDate] = useState('');
  const [date, setDate] = useState('');
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [detailCustomer, setDetailCustomer] = useState(null);
  const [fullDetail, setFullDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [callForm, setCallForm] = useState({ call_result: '', remarks: '' });
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ customer_name: '', gender: '', age: '', address: '', customer_type: '' });
  const [saving, setSaving] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
  const limit = 50;
  const isHO = ['ADMIN', 'HO_STAFF', 'DIRECTOR'].includes(user?.role);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page, limit };
    if (date) params.date = date;
    if (storeFilter !== 'all') params.store_id = storeFilter;
    api.get('/crm/sales-call-tasks', { params })
      .then(r => { setTasks(r.data.tasks); setTotal(r.data.total); setSalesDate(r.data.sales_date); })
      .catch(() => toast.error('Failed'))
      .finally(() => setLoading(false));
  }, [page, date, storeFilter]);

  const openDetail = async (t) => {
    setDetailCustomer(t); setCallForm({ call_result: '', remarks: '' }); setEditMode(false); setDetailTab('overview');
    setDetailLoading(true); setFullDetail(null);
    try {
      const res = await api.get(`/crm/customers/${t.customer_id}/call-detail`);
      setFullDetail(res.data);
      setEditForm({ customer_name: res.data.profile.customer_name || '', gender: res.data.profile.gender || '', age: res.data.profile.age || '', address: res.data.profile.address || '', customer_type: res.data.profile.customer_type || '' });
    } catch { toast.error('Failed to load details'); }
    finally { setDetailLoading(false); }
  };

  const handleSaveEdit = async () => {
    if (!detailCustomer) return; setSaving(true);
    try {
      await api.put(`/crm/customers/${detailCustomer.customer_id}/update`, { ...editForm, age: editForm.age ? parseInt(editForm.age) : null });
      toast.success('Customer updated'); setEditMode(false);
      const res = await api.get(`/crm/customers/${detailCustomer.customer_id}/call-detail`);
      setFullDetail(res.data);
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleCall = async (e) => {
    e.preventDefault();
    if (!detailCustomer) return;
    setSaving(true);
    try {
      await api.post('/crm/calls', { customer_id: detailCustomer.customer_id, call_result: callForm.call_result, remarks: callForm.remarks });
      toast.success('Call logged');
      setCallForm({ call_result: '', remarks: '' });
      // Refresh to update already_called status
      const params = { page, limit };
      if (date) params.date = date;
      if (storeFilter !== 'all') params.store_id = storeFilter;
      api.get('/crm/sales-call-tasks', { params }).then(r => setTasks(r.data.tasks));
      setDetailCustomer(null);
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const totalPages = Math.ceil(total / limit);
  const resultColor = { reached: 'bg-sky-50 text-sky-700', confirmed: 'bg-emerald-50 text-emerald-700', not_reachable: 'bg-red-50 text-red-700', callback: 'bg-amber-50 text-amber-700', discontinued: 'bg-slate-100 text-slate-600' };
  const typeBadge = { rc: 'bg-rose-100 text-rose-700', chronic: 'bg-violet-100 text-violet-700', high_value: 'bg-amber-100 text-amber-700', walkin: 'bg-slate-100 text-slate-600' };

  return (
    <div data-testid="sales-call-tasks-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Sales Follow-Up Calls</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{total} customers from {salesDate ? new Date(salesDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'yesterday'}'s sales</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(1); }} className="w-[160px] font-body text-sm rounded-sm h-8" data-testid="task-date" />
          {isHO && (
            <Select value={storeFilter} onValueChange={v => { setStoreFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px] font-body text-sm rounded-sm h-8"><SelectValue placeholder="All Stores" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-240px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Customer', 'Mobile', 'Type', 'Store', 'Invoice Amt', 'Items', 'Active Meds', 'Status', 'Action'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Invoice Amt', 'Items', 'Active Meds'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-16"><Phone className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">{loading ? 'Loading...' : 'No sales call tasks'}</p></TableCell></TableRow>
              ) : tasks.map(t => (
                <TableRow key={t.customer_id} className={`hover:bg-slate-50/50 ${t.already_called ? 'opacity-50' : ''}`} data-testid={`task-row-${t.customer_id}`}>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => navigate(`/crm/customer/${t.customer_id}`)}>{t.customer_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{t.mobile}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${typeBadge[t.customer_type] || 'bg-slate-100 text-slate-600'}`}>{t.customer_type}</Badge></TableCell>
                  <TableCell className="text-[12px] text-slate-500">{t.store_name}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums font-medium">INR {t.invoice_total.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{t.item_count}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{t.active_medicines?.length || 0}</TableCell>
                  <TableCell>
                    {t.already_called ? <Badge className="text-[9px] rounded-sm bg-emerald-50 text-emerald-700"><CheckCircle className="w-2.5 h-2.5 mr-0.5 inline" />Called</Badge> : <Badge className="text-[9px] rounded-sm bg-amber-50 text-amber-700">Pending</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" className="h-7 px-2.5 rounded-sm text-[11px] font-body" onClick={() => openDetail(t)} data-testid={`call-btn-${t.customer_id}`}>
                      <Phone className="w-3 h-3 mr-1" /> {t.already_called ? 'View' : 'Call'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} | {total} customers</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="h-7 w-7 p-0 rounded-sm"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages} className="h-7 w-7 p-0 rounded-sm"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>

      {/* Customer Detail + Call Log Popup */}
      <Dialog open={!!detailCustomer} onOpenChange={v => { if (!v) { setDetailCustomer(null); setFullDetail(null); } }}>
        <DialogContent className="rounded-sm max-w-2xl max-h-[90vh] overflow-auto p-0">
          <DialogHeader className="px-5 pt-5 pb-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="font-heading">{fullDetail?.profile?.customer_name || detailCustomer?.customer_name}</DialogTitle>
              {fullDetail && !editMode && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-slate-500" onClick={() => setEditMode(true)}><Edit3 className="w-3 h-3 mr-1" />Edit</Button>
              )}
            </div>
          </DialogHeader>
          {detailLoading ? (
            <div className="p-8 text-center text-sm text-slate-400">Loading customer details...</div>
          ) : fullDetail ? (
            <div className="px-5 pb-5 space-y-4">
              {/* Profile + Stats Row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 text-[12px] font-body">
                  <div className="flex gap-2"><User className="w-3.5 h-3.5 text-slate-400 mt-0.5" /><div><span className="text-slate-400">Mobile</span><p className="font-medium">{fullDetail.profile.mobile_number}</p></div></div>
                  <div className="flex gap-2"><span className="text-slate-400">Store:</span><span className="font-medium">{fullDetail.profile.store_name}</span></div>
                  <div className="flex gap-2"><span className="text-slate-400">Gender:</span><span>{fullDetail.profile.gender || '-'}</span><span className="text-slate-400 ml-2">Age:</span><span>{fullDetail.profile.age || '-'}</span></div>
                  <div className="flex gap-2"><span className="text-slate-400">Address:</span><span className="truncate">{fullDetail.profile.address || '-'}</span></div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[9px] rounded-sm ${typeBadge[fullDetail.profile.customer_type] || 'bg-slate-100'}`}>{fullDetail.profile.customer_type}</Badge>
                    {fullDetail.profile.chronic_tags?.map(t => <Badge key={t} className="text-[8px] rounded-sm bg-violet-50 text-violet-600">{t}</Badge>)}
                  </div>
                  {fullDetail.profile.assigned_staff && <div className="flex gap-2"><span className="text-slate-400">Assigned:</span><span className="font-medium text-violet-700">{fullDetail.profile.assigned_staff}</span></div>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { l: 'Total Spent', v: `INR ${fullDetail.stats.total_spent.toLocaleString('en-IN')}`, c: 'text-emerald-700' },
                    { l: 'Invoices', v: fullDetail.stats.total_invoices, c: 'text-sky-700' },
                    { l: 'Items Bought', v: fullDetail.stats.total_items, c: 'text-slate-800' },
                    { l: 'CLV', v: `INR ${fullDetail.profile.clv_value.toLocaleString('en-IN')}`, c: 'text-amber-700' },
                  ].map(k => (
                    <div key={k.l} className="p-2 bg-slate-50 rounded-sm"><p className="text-[9px] text-slate-400 uppercase">{k.l}</p><p className={`text-[14px] font-bold tabular-nums ${k.c}`}>{k.v}</p></div>
                  ))}
                </div>
              </div>

              {/* Edit Form */}
              {editMode && (
                <div className="p-3 border border-sky-200 bg-sky-50/30 rounded-sm space-y-2">
                  <p className="text-[10px] font-body font-medium text-sky-700 uppercase">Edit Customer</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="font-body text-[10px]">Name</Label><Input value={editForm.customer_name} onChange={e => setEditForm({...editForm, customer_name: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                    <div><Label className="font-body text-[10px]">Type</Label>
                      <Select value={editForm.customer_type} onValueChange={v => setEditForm({...editForm, customer_type: v})}><SelectTrigger className="rounded-sm h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="walkin">Walk-in</SelectItem><SelectItem value="rc">RC</SelectItem><SelectItem value="chronic">Chronic</SelectItem></SelectContent></Select></div>
                    <div><Label className="font-body text-[10px]">Gender</Label>
                      <Select value={editForm.gender || 'none'} onValueChange={v => setEditForm({...editForm, gender: v === 'none' ? '' : v})}><SelectTrigger className="rounded-sm h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="none">-</SelectItem><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent></Select></div>
                    <div><Label className="font-body text-[10px]">Age</Label><Input type="number" value={editForm.age} onChange={e => setEditForm({...editForm, age: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                  </div>
                  <div><Label className="font-body text-[10px]">Address</Label><Input value={editForm.address} onChange={e => setEditForm({...editForm, address: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" className="rounded-sm text-xs h-7" onClick={() => setEditMode(false)}>Cancel</Button>
                    <Button size="sm" className="bg-sky-500 hover:bg-sky-600 rounded-sm text-xs h-7" onClick={handleSaveEdit} disabled={saving}><Save className="w-3 h-3 mr-1" />{saving ? 'Saving...' : 'Save'}</Button>
                  </div>
                </div>
              )}

              {/* Tabs: Purchases / Medicines / Calls */}
              <div className="flex gap-1 border-b border-slate-200">
                {[
                  { k: 'overview', l: `Purchases (${fullDetail.recent_invoices?.length || 0})` },
                  { k: 'medicines', l: `Medicines (${fullDetail.active_medicines?.length || 0})` },
                  { k: 'calls', l: `Calls (${fullDetail.call_history?.length || 0})` },
                ].map(t => (
                  <button key={t.k} className={`px-3 py-1.5 text-[11px] font-body border-b-2 transition-colors ${detailTab === t.k ? 'border-sky-500 text-sky-700 font-medium' : 'border-transparent text-slate-400 hover:text-slate-600'}`} onClick={() => setDetailTab(t.k)}>{t.l}</button>
                ))}
              </div>

              {detailTab === 'overview' && (
                <div className="space-y-2 max-h-[200px] overflow-auto">
                  {fullDetail.recent_invoices?.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">No purchase history</p> :
                    fullDetail.recent_invoices?.map((inv, i) => (
                      <div key={i} className="p-2 border border-slate-100 rounded-sm">
                        <div className="flex items-center justify-between text-[11px] font-body">
                          <span className="flex items-center gap-1.5"><Receipt className="w-3 h-3 text-slate-400" />{inv.entry_number || 'N/A'} | {inv.date ? new Date(inv.date).toLocaleDateString() : '-'}</span>
                          <span className="font-medium text-emerald-700">INR {inv.total.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="mt-1 space-y-0.5">{inv.items.map((it, j) => (
                          <p key={j} className="text-[10px] font-body text-slate-500 flex justify-between"><span>{it.product}</span><span className="tabular-nums">INR {it.amount}</span></p>
                        ))}</div>
                      </div>
                    ))
                  }
                </div>
              )}

              {detailTab === 'medicines' && (
                <div className="space-y-2 max-h-[200px] overflow-auto">
                  {fullDetail.active_medicines?.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">No active medicines</p> :
                    fullDetail.active_medicines?.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 border border-slate-100 rounded-sm text-[12px] font-body">
                        <Pill className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                        <div className="flex-1"><span className="font-medium">{m.medicine}</span>{m.dosage && <span className="text-slate-400 ml-2">| {m.dosage}</span>}{m.timing && <span className="text-slate-400 ml-1">| {m.timing}</span>}{m.food_relation && <span className="text-slate-400 ml-1">| {m.food_relation.replace('_', ' ')}</span>}</div>
                        {m.next_due && <Badge className="text-[8px] rounded-sm bg-amber-50 text-amber-700 shrink-0">Due: {new Date(m.next_due).toLocaleDateString()}</Badge>}
                      </div>
                    ))
                  }
                </div>
              )}

              {detailTab === 'calls' && (
                <div className="space-y-1.5 max-h-[200px] overflow-auto">
                  {fullDetail.call_history?.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">No call history</p> :
                    fullDetail.call_history?.map((cl, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 text-[11px] font-body border-b border-slate-50 last:border-0">
                        <Badge className={`text-[8px] rounded-sm shrink-0 ${resultColor[cl.result] || 'bg-slate-100'}`}>{cl.result?.replace('_', ' ')}</Badge>
                        <span className="text-violet-700 font-medium shrink-0">{cl.caller}</span>
                        <span className="text-slate-500 truncate flex-1">{cl.remarks || '-'}</span>
                        <span className="text-slate-300 text-[10px] shrink-0">{cl.date ? new Date(cl.date).toLocaleDateString() : ''}</span>
                      </div>
                    ))
                  }
                </div>
              )}

              {/* Log Call */}
              {!detailCustomer?.already_called ? (
                <form onSubmit={handleCall} className="space-y-2 border-t border-slate-200 pt-3">
                  <p className="text-[10px] font-body font-medium text-slate-700 uppercase">Log Call</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={callForm.call_result} onValueChange={v => setCallForm({...callForm, call_result: v})}>
                      <SelectTrigger className="rounded-sm h-8 text-sm"><SelectValue placeholder="Result *" /></SelectTrigger>
                      <SelectContent><SelectItem value="reached">Reached</SelectItem><SelectItem value="not_reachable">Not Reachable</SelectItem><SelectItem value="callback">Callback</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="discontinued">Discontinued</SelectItem></SelectContent>
                    </Select>
                    <Input value={callForm.remarks} onChange={e => setCallForm({...callForm, remarks: e.target.value})} placeholder="Remarks..." className="rounded-sm h-8 text-sm" />
                  </div>
                  <Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs w-full" disabled={saving || !callForm.call_result}><Phone className="w-3 h-3 mr-1" />{saving ? 'Saving...' : 'Log Call'}</Button>
                </form>
              ) : (
                <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-sm border border-emerald-200">
                  <CheckCircle className="w-4 h-4 text-emerald-600" /><span className="text-[12px] font-body text-emerald-700 font-medium">Already called today</span>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
