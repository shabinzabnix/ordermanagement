import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { toast } from 'sonner';
import { CalendarClock, Search, Phone, CheckCircle, AlertTriangle } from 'lucide-react';

export default function RefillDuePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [callDialog, setCallDialog] = useState(null);
  const [callForm, setCallForm] = useState({ call_result: '', remarks: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    const params = { page: 1, limit: 100 };
    if (category !== 'all') params.category = category;
    if (storeFilter !== 'all') params.store_id = storeFilter;
    if (search) params.search = search;
    api.get('/crm/refill-due', { params }).then(r => { setItems(r.data.items); setTotal(r.data.total); }).catch(() => {});
  }, [category, storeFilter, search]);

  const handleCall = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/crm/calls', { customer_id: callDialog.customer_id, purchase_id: callDialog.id, call_result: callForm.call_result, remarks: callForm.remarks });
      toast.success('Call logged');
      if (callForm.call_result === 'confirmed') {
        navigate(`/crm/customer/${callDialog.customer_id}`);
      }
      setCallDialog(null); setCallForm({ call_result: '', remarks: '' });
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };

  const dueBadge = (d) => {
    if (d.overdue) return 'bg-red-100 text-red-700';
    if (d.days_until <= 0) return 'bg-red-50 text-red-700';
    if (d.days_until <= 3) return 'bg-amber-50 text-amber-700';
    return 'bg-emerald-50 text-emerald-700';
  };

  return (
    <div data-testid="refill-due-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Refill Due Management</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Customers who need medicine refills</p>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="flex gap-3 flex-wrap">
            <div className="flex gap-1.5">
              {[{ v: 'all', l: 'All' }, { v: 'overdue', l: 'Overdue' }, { v: 'today', l: 'Today' }, { v: '3days', l: '3 Days' }, { v: '7days', l: '7 Days' }].map(f => (
                <Button key={f.v} variant={category === f.v ? 'default' : 'outline'} size="sm"
                  className={`rounded-sm font-body text-xs ${category === f.v ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
                  onClick={() => setCategory(f.v)} data-testid={`due-filter-${f.v}`}>{f.l}</Button>
              ))}
            </div>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[180px] font-body text-sm rounded-sm"><SelectValue placeholder="All Stores" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input data-testid="refill-search" placeholder="Search customer, mobile or medicine..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" /></div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-300px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Customer', 'Mobile', 'Store', 'Medicine', 'Last Purchase', 'Due Date', 'Status', 'Actions'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16"><CalendarClock className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No refills due</p></TableCell></TableRow>
              ) : items.map(d => (
                <TableRow key={d.id} className="hover:bg-slate-50/50" data-testid={`refill-row-${d.id}`}>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => navigate(`/crm/customer/${d.customer_id}`)}>{d.customer_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{d.mobile_number}</TableCell>
                  <TableCell className="text-[12px] text-slate-500">{d.store_name}</TableCell>
                  <TableCell className="font-body text-[13px] text-slate-700">{d.medicine_name}</TableCell>
                  <TableCell className="text-[11px] text-slate-400">{d.purchase_date ? new Date(d.purchase_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-[11px] text-slate-600 font-medium">{d.next_due_date ? new Date(d.next_due_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${dueBadge(d)}`}>
                    {d.overdue ? `${Math.abs(d.days_until)}d overdue` : d.days_until === 0 ? 'Due today' : `${d.days_until}d left`}
                  </Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] font-body"
                        onClick={() => navigate(`/crm/customer/${d.customer_id}`)} data-testid={`refill-purchase-${d.id}`}><CheckCircle className="w-3 h-3 mr-1" /> Update</Button>
                      <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] font-body"
                        onClick={() => setCallDialog(d)} data-testid={`refill-call-${d.id}`}><Phone className="w-3 h-3 mr-1" /> Call</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Call Dialog */}
      <Dialog open={!!callDialog} onOpenChange={(v) => { if (!v) setCallDialog(null); }}>
        <DialogContent className="rounded-sm">
          <DialogHeader><DialogTitle className="font-heading">Log Call - {callDialog?.customer_name}</DialogTitle></DialogHeader>
          <p className="text-sm font-body text-slate-500">Medicine: {callDialog?.medicine_name} | Due: {callDialog?.next_due_date ? new Date(callDialog.next_due_date).toLocaleDateString() : '-'}</p>
          <form onSubmit={handleCall} className="space-y-3 mt-2">
            <div className="space-y-1.5"><Label className="font-body text-xs">Call Result *</Label>
              <Select value={callForm.call_result} onValueChange={v => setCallForm({...callForm, call_result: v})}>
                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select result" /></SelectTrigger>
                <SelectContent><SelectItem value="reached">Reached</SelectItem><SelectItem value="not_reachable">Not Reachable</SelectItem><SelectItem value="callback">Call Back Later</SelectItem><SelectItem value="confirmed">Confirmed Purchase</SelectItem><SelectItem value="discontinued">Medicine Discontinued</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label className="font-body text-xs">Remarks</Label>
              <Textarea value={callForm.remarks} onChange={e => setCallForm({...callForm, remarks: e.target.value})} className="rounded-sm" rows={3} placeholder="Customer notes..." /></div>
            <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving || !callForm.call_result}>{saving ? 'Saving...' : 'Log Call'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
