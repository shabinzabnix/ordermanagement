import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import {
  Heart, Users, CalendarClock, Phone, AlertTriangle,
  Plus, Search, ChevronLeft, ChevronRight, Clock, CheckCircle,
} from 'lucide-react';

export default function CRMDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [stores, setStores] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ mobile_number: '', customer_name: '', gender: '', age: '', address: '', store_id: '', customer_type: 'walkin' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/crm/dashboard'),
      api.get('/stores'),
      api.get('/crm/calls', { params: { limit: 5 } }),
    ]).then(([d, s, c]) => {
      setStats(d.data);
      setStores(s.data.stores);
      setCalls(c.data.calls);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const params = { page, limit: 30 };
    if (search) params.search = search;
    if (typeFilter !== 'all') params.customer_type = typeFilter;
    api.get('/crm/customers', { params }).then(r => { setCustomers(r.data.customers); setTotal(r.data.total); }).catch(() => {});
  }, [page, search, typeFilter]);

  useEffect(() => {
    if (user?.role === 'STORE_STAFF' && user?.store_id && !form.store_id) {
      setForm(f => ({ ...f, store_id: String(user.store_id) }));
    }
  }, [user]);

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/crm/customers', { ...form, store_id: parseInt(form.store_id), age: form.age ? parseInt(form.age) : null });
      toast.success('Customer created');
      setAddOpen(false);
      setForm({ mobile_number: '', customer_name: '', gender: '', age: '', address: '', store_id: user?.role === 'STORE_STAFF' ? String(user?.store_id || '') : '', customer_type: 'walkin' });
      setPage(1);
      navigate(`/crm/customer/${res.data.id}`);
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="space-y-4"><div className="grid grid-cols-4 gap-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24 rounded-sm" />)}</div></div>;

  const kpis = [
    { label: 'Total Customers', value: stats?.total_customers || 0, icon: Users, bg: 'bg-sky-50', fg: 'text-sky-600' },
    { label: 'RC Customers', value: stats?.rc_customers || 0, icon: Heart, bg: 'bg-rose-50', fg: 'text-rose-600' },
    { label: 'Due Today', value: stats?.due_today || 0, icon: CalendarClock, bg: 'bg-amber-50', fg: 'text-amber-600' },
    { label: 'Overdue', value: stats?.overdue || 0, icon: AlertTriangle, bg: 'bg-red-50', fg: 'text-red-600' },
    { label: 'Due 3 Days', value: stats?.due_3days || 0, icon: Clock, bg: 'bg-orange-50', fg: 'text-orange-600' },
    { label: 'Upcoming 7d', value: stats?.upcoming_7days || 0, icon: CalendarClock, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
    { label: 'Calls Today', value: stats?.calls_today || 0, icon: Phone, bg: 'bg-violet-50', fg: 'text-violet-600' },
    { label: 'Pending Tasks', value: stats?.pending_tasks || 0, icon: CheckCircle, bg: 'bg-blue-50', fg: 'text-blue-600' },
  ];

  const typeBadge = (t) => {
    const map = { rc: 'bg-rose-50 text-rose-700', chronic: 'bg-violet-50 text-violet-700', high_value: 'bg-amber-50 text-amber-700', walkin: 'bg-slate-100 text-slate-600' };
    return map[t] || 'bg-slate-100 text-slate-600';
  };

  const callBadge = (r) => {
    const map = { reached: 'bg-emerald-50 text-emerald-700', confirmed: 'bg-sky-50 text-sky-700', not_reachable: 'bg-red-50 text-red-700', callback: 'bg-amber-50 text-amber-700', discontinued: 'bg-slate-100 text-slate-600' };
    return map[r] || 'bg-slate-100 text-slate-600';
  };

  return (
    <div data-testid="crm-dashboard-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">CRM Dashboard</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Patient medicine lifecycle management</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-sm font-body text-xs" onClick={() => navigate('/crm/refill-due')} data-testid="go-refill-due-btn">
            <CalendarClock className="w-3.5 h-3.5 mr-1.5" /> Refill Due
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" data-testid="add-crm-customer-btn">
                <Plus className="w-3.5 h-3.5 mr-1.5" /> New Customer
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-sm max-w-lg">
              <DialogHeader><DialogTitle className="font-heading">Register Customer</DialogTitle></DialogHeader>
              <form onSubmit={handleAddCustomer} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="font-body text-xs">Mobile *</Label>
                    <Input data-testid="crm-mobile" value={form.mobile_number} onChange={e => setForm({...form, mobile_number: e.target.value})} required className="rounded-sm" /></div>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Name *</Label>
                    <Input data-testid="crm-name" value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} required className="rounded-sm" /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5"><Label className="font-body text-xs">Gender</Label>
                    <Select value={form.gender || 'none'} onValueChange={v => setForm({...form, gender: v === 'none' ? '' : v})}>
                      <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent><SelectItem value="none">-</SelectItem><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
                    </Select></div>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Age</Label>
                    <Input data-testid="crm-age" type="number" value={form.age} onChange={e => setForm({...form, age: e.target.value})} className="rounded-sm" /></div>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Type</Label>
                    <Select value={form.customer_type} onValueChange={v => setForm({...form, customer_type: v})}>
                      <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="walkin">Walk-in</SelectItem><SelectItem value="rc">RC</SelectItem><SelectItem value="chronic">Chronic</SelectItem><SelectItem value="high_value">High Value</SelectItem></SelectContent>
                    </Select></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
                    <Select value={form.store_id} onValueChange={v => setForm({...form, store_id: v})} disabled={user?.role === 'STORE_STAFF'}>
                      <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Address</Label>
                    <Input data-testid="crm-address" value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="rounded-sm" /></div>
                </div>
                <DialogFooter><Button type="submit" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving} data-testid="save-crm-customer-btn">{saving ? 'Saving...' : 'Register'}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(k => (
          <Card key={k.label} className="border-slate-200 shadow-sm rounded-sm hover:-translate-y-px transition-transform">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div><p className="text-[10px] font-body font-medium text-slate-400 uppercase tracking-wider">{k.label}</p>
                  <p className="text-xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.value}</p></div>
                <div className={`p-2 rounded-sm ${k.bg}`}><k.icon className={`w-4 h-4 ${k.fg}`} strokeWidth={1.75} /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-3">
              <div className="flex gap-3">
                <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input data-testid="crm-search" placeholder="Search by name or mobile..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 font-body text-sm rounded-sm" /></div>
                <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-[140px] font-body text-sm rounded-sm"><SelectValue placeholder="All Types" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="rc">RC</SelectItem><SelectItem value="chronic">Chronic</SelectItem><SelectItem value="high_value">High Value</SelectItem><SelectItem value="walkin">Walk-in</SelectItem></SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-520px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Name', 'Mobile', 'Store', 'Type', 'Medicines', 'Registered'].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-16"><Users className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No customers</p></TableCell></TableRow>
                  ) : customers.map(c => (
                    <TableRow key={c.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => navigate(`/crm/customer/${c.id}`)} data-testid={`crm-customer-row-${c.id}`}>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{c.customer_name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{c.mobile_number}</TableCell>
                      <TableCell className="text-[12px] text-slate-500">{c.store_name}</TableCell>
                      <TableCell><Badge className={`text-[10px] rounded-sm ${typeBadge(c.customer_type)}`}>{c.customer_type?.replace('_', ' ')}</Badge></TableCell>
                      <TableCell className="text-[12px] tabular-nums">{c.active_medicines}</TableCell>
                      <TableCell className="text-[11px] text-slate-400">{c.registration_date ? new Date(c.registration_date).toLocaleDateString() : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {Math.ceil(total / 30) > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
                <p className="text-[11px] text-slate-400 font-body">Page {page}/{Math.ceil(total / 30)}</p>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="h-7 w-7 p-0 rounded-sm"><ChevronLeft className="w-3.5 h-3.5" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p+1)} disabled={page >= Math.ceil(total / 30)} className="h-7 w-7 p-0 rounded-sm"><ChevronRight className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            )}
          </Card>
        </div>
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Phone className="w-4 h-4 text-slate-400" /> Recent Calls</CardTitle></CardHeader>
          <CardContent>
            {calls.length > 0 ? calls.map(cl => (
              <div key={cl.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-body font-medium text-slate-800">{cl.customer_name}</p>
                  <p className="text-[11px] font-body text-slate-400">{cl.caller_name} - {cl.remarks || 'No remarks'}</p>
                </div>
                <Badge className={`text-[10px] rounded-sm ml-2 shrink-0 ${callBadge(cl.call_result)}`}>{cl.call_result?.replace('_', ' ')}</Badge>
              </div>
            )) : <div className="text-center py-8"><Phone className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400 font-body">No calls logged</p></div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
