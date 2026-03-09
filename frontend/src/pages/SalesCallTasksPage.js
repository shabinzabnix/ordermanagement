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
import { Phone, CheckCircle, ChevronLeft, ChevronRight, Pill, Clock, User, IndianRupee } from 'lucide-react';

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
  const [callForm, setCallForm] = useState({ call_result: '', remarks: '' });
  const [saving, setSaving] = useState(false);
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
                    <Button size="sm" variant="outline" className="h-7 px-2.5 rounded-sm text-[11px] font-body" onClick={() => { setDetailCustomer(t); setCallForm({ call_result: '', remarks: '' }); }} data-testid={`call-btn-${t.customer_id}`}>
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
      <Dialog open={!!detailCustomer} onOpenChange={v => { if (!v) setDetailCustomer(null); }}>
        <DialogContent className="rounded-sm max-w-lg max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle className="font-heading">{detailCustomer?.customer_name}</DialogTitle></DialogHeader>
          {detailCustomer && (
            <div className="space-y-4">
              {/* Customer Info */}
              <div className="grid grid-cols-2 gap-3 text-[12px] font-body">
                <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 text-slate-400" /><span className="text-slate-500">Mobile:</span><span className="font-medium">{detailCustomer.mobile}</span></div>
                <div className="flex items-center gap-2"><Badge className={`text-[9px] rounded-sm ${typeBadge[detailCustomer.customer_type] || 'bg-slate-100'}`}>{detailCustomer.customer_type}</Badge></div>
                <div className="flex items-center gap-2"><IndianRupee className="w-3.5 h-3.5 text-slate-400" /><span className="text-slate-500">Invoice:</span><span className="font-medium text-emerald-700">INR {detailCustomer.invoice_total.toLocaleString('en-IN')}</span></div>
                <div className="flex items-center gap-2"><span className="text-slate-500">CLV:</span><span className="font-medium">INR {detailCustomer.clv_value.toLocaleString('en-IN')}</span></div>
              </div>

              {/* Active Medicines */}
              {detailCustomer.active_medicines?.length > 0 && (
                <div className="p-3 bg-sky-50/50 border border-sky-200 rounded-sm">
                  <p className="text-[10px] font-body font-medium text-sky-700 uppercase tracking-wider mb-2">Active Medicines</p>
                  {detailCustomer.active_medicines.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 text-[12px] font-body">
                      <Pill className="w-3 h-3 text-sky-500" /><span className="font-medium">{m.medicine}</span>
                      {m.dosage && <span className="text-slate-400">| {m.dosage}</span>}
                      {m.next_due && <Badge className="text-[8px] rounded-sm bg-amber-50 text-amber-700 ml-auto">Due: {new Date(m.next_due).toLocaleDateString()}</Badge>}
                    </div>
                  ))}
                </div>
              )}

              {/* Previous Call History */}
              {detailCustomer.call_history?.length > 0 && (
                <div className="p-3 bg-violet-50/50 border border-violet-200 rounded-sm">
                  <p className="text-[10px] font-body font-medium text-violet-700 uppercase tracking-wider mb-2">Previous Calls</p>
                  {detailCustomer.call_history.map((cl, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 text-[11px] font-body border-b border-violet-100 last:border-0">
                      <Badge className={`text-[8px] rounded-sm ${resultColor[cl.result] || 'bg-slate-100'}`}>{cl.result?.replace('_', ' ')}</Badge>
                      <span className="text-violet-700 font-medium">{cl.caller}</span>
                      <span className="text-slate-400 truncate flex-1">{cl.remarks || '-'}</span>
                      <span className="text-slate-300 text-[10px] shrink-0">{cl.date ? new Date(cl.date).toLocaleDateString() : ''}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Log Call Form */}
              {!detailCustomer.already_called && (
                <form onSubmit={handleCall} className="space-y-3 border-t border-slate-200 pt-3">
                  <p className="text-[11px] font-body font-medium text-slate-700 uppercase tracking-wider">Log Call</p>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Result *</Label>
                    <Select value={callForm.call_result} onValueChange={v => setCallForm({...callForm, call_result: v})}>
                      <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent><SelectItem value="reached">Reached</SelectItem><SelectItem value="not_reachable">Not Reachable</SelectItem><SelectItem value="callback">Callback</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="discontinued">Discontinued</SelectItem></SelectContent>
                    </Select></div>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Remarks</Label>
                    <Textarea value={callForm.remarks} onChange={e => setCallForm({...callForm, remarks: e.target.value})} className="rounded-sm" rows={2} /></div>
                  <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving || !callForm.call_result}>{saving ? 'Saving...' : 'Log Call'}</Button></DialogFooter>
                </form>
              )}
              {detailCustomer.already_called && (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-sm border border-emerald-200">
                  <CheckCircle className="w-4 h-4 text-emerald-600" /><span className="text-[12px] font-body text-emerald-700 font-medium">Already called today</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
