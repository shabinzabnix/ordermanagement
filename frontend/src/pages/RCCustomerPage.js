import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { UserCheck, Plus, Bell, Trash2 } from 'lucide-react';

export default function RCCustomerPage() {
  const [customers, setCustomers] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [stores, setStores] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    store_id: '', customer_name: '', mobile_number: '', medicine_name: '',
    last_purchase_date: '', duration_of_medication: '', days_of_consumption: '',
  });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const loadData = () => {
    const params = {};
    if (search) params.search = search;
    api.get('/customers', { params }).then(r => setCustomers(r.data.customers)).catch(() => {});
    api.get('/customers/refill-reminders').then(r => setReminders(r.data.reminders)).catch(() => {});
  };
  useEffect(() => { loadData(); }, [search]);
  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/customers', {
        ...form,
        store_id: parseInt(form.store_id),
        duration_of_medication: parseInt(form.duration_of_medication) || 0,
        days_of_consumption: parseInt(form.days_of_consumption) || 0,
      });
      toast.success('Customer onboarded');
      setOpen(false);
      setForm({ store_id: '', customer_name: '', mobile_number: '', medicine_name: '', last_purchase_date: '', duration_of_medication: '', days_of_consumption: '' });
      loadData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/customers/${id}`);
      toast.success('Customer removed');
      loadData();
    } catch { toast.error('Failed to delete'); }
  };

  return (
    <div data-testid="rc-customer-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">RC Customers</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Recurrent customer management & refill tracking</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-customer-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Onboard Customer
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-sm max-w-lg">
            <DialogHeader><DialogTitle className="font-heading">Onboard RC Customer</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="font-body text-xs">Store *</Label>
                <Select value={form.store_id} onValueChange={v => setForm({...form, store_id: v})}>
                  <SelectTrigger className="rounded-sm" data-testid="customer-store"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Customer Name *</Label>
                  <Input data-testid="customer-name" value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} required className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Mobile Number *</Label>
                  <Input data-testid="customer-mobile" value={form.mobile_number} onChange={e => setForm({...form, mobile_number: e.target.value})} required className="rounded-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="font-body text-xs">Medicine Name *</Label>
                <Input data-testid="customer-medicine" value={form.medicine_name} onChange={e => setForm({...form, medicine_name: e.target.value})} required className="rounded-sm" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Last Purchase Date</Label>
                  <Input data-testid="customer-date" type="date" value={form.last_purchase_date} onChange={e => setForm({...form, last_purchase_date: e.target.value})} className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Duration (days)</Label>
                  <Input data-testid="customer-duration" type="number" value={form.duration_of_medication} onChange={e => setForm({...form, duration_of_medication: e.target.value})} className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Consumption (days)</Label>
                  <Input data-testid="customer-consumption" type="number" value={form.days_of_consumption} onChange={e => setForm({...form, days_of_consumption: e.target.value})} className="rounded-sm" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="save-customer-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>
                  {saving ? 'Saving...' : 'Onboard Customer'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {reminders.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30 shadow-sm rounded-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-600" /> Refill Reminders ({reminders.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {reminders.map(r => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b border-amber-100 last:border-0">
                  <div>
                    <p className="text-[13px] font-body font-medium text-slate-800">{r.customer_name} - {r.medicine_name}</p>
                    <p className="text-[11px] font-body text-slate-500">{r.store_name} | {r.mobile_number}</p>
                  </div>
                  <Badge className={`text-[10px] rounded-sm ${r.overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {r.overdue ? `${Math.abs(r.days_until)}d overdue` : `${r.days_until}d left`}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <Input data-testid="customer-search" placeholder="Search customers or medicines..." value={search}
            onChange={e => setSearch(e.target.value)} className="font-body text-sm rounded-sm" />
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-400px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Store', 'Customer', 'Mobile', 'Medicine', 'Last Purchase', 'Duration', 'Consumption', ''].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16">
                  <UserCheck className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No RC customers</p>
                </TableCell></TableRow>
              ) : customers.map(c => (
                <TableRow key={c.id} className="hover:bg-slate-50/50" data-testid={`customer-row-${c.id}`}>
                  <TableCell className="text-[12px] font-body text-slate-600">{c.store_name}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{c.customer_name}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{c.mobile_number}</TableCell>
                  <TableCell className="font-body text-[13px] text-slate-700">{c.medicine_name}</TableCell>
                  <TableCell className="text-[11px] text-slate-500">{c.last_purchase_date ? new Date(c.last_purchase_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-[12px] tabular-nums">{c.duration_of_medication}d</TableCell>
                  <TableCell className="text-[12px] tabular-nums">{c.days_of_consumption}d</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => handleDelete(c.id)} data-testid={`delete-customer-${c.id}`}><Trash2 className="w-3 h-3" /></Button>
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
