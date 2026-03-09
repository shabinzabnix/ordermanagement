import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { Users, UserCheck, AlertTriangle, CalendarClock, TrendingUp, Pill, Phone, ArrowRight, Clock, Receipt, Loader2, IndianRupee } from 'lucide-react';
import { FollowupButton } from '../components/FollowupButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Pagination } from '../components/Pagination';

export default function StoreCRMDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [perf, setPerf] = useState(null);
  const [calls, setCalls] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [perfDays, setPerfDays] = useState('30');
  const [loading, setLoading] = useState(true);
  const [rcCandidates, setRcCandidates] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [candidateDetail, setCandidateDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const PER_PAGE = 20;
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [followupPage, setFollowupPage] = useState(1);
  const [rcPurchasePage, setRcPurchasePage] = useState(1);
  const [newCustPage, setNewCustPage] = useState(1);
  const [callPage, setCallPage] = useState(1);
  const [rcCandPage, setRcCandPage] = useState(1);

  const load = () => {
    setLoading(true);
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    api.get('/crm/store-crm-dashboard', { params }).then(r => setData(r.data)).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  };
  const loadPerf = () => {
    api.get('/crm/staff-performance', { params: { days: perfDays } }).then(r => setPerf(r.data)).catch(() => {});
  };
  const loadCalls = () => {
    api.get('/crm/calls', { params: { limit: 50 } }).then(r => setCalls(r.data.calls || [])).catch(() => {});
  };
  const loadRcCandidates = () => {
    api.get('/crm/rc-candidates').then(r => setRcCandidates(r.data.candidates || [])).catch(() => {});
  };
  const loadFollowups = () => {
    api.get('/crm/followups').then(r => setFollowups(r.data.followups || [])).catch(() => {});
  };
  const openCandidateDetail = (c) => {
    setCandidateDetail(null); setDetailLoading(true);
    api.get(`/crm/customers/${c.customer_id}/call-detail`).then(r => setCandidateDetail({ ...r.data, rc_info: c })).catch(() => toast.error('Failed')).finally(() => setDetailLoading(false));
  };

  useEffect(() => { load(); loadPerf(); loadCalls(); loadRcCandidates(); loadFollowups(); }, []);
  useEffect(() => { load(); }, [dateFrom, dateTo]);
  useEffect(() => { loadPerf(); }, [perfDays]);

  const kpis = data?.kpis || {};
  const paginate = (arr, page) => (arr || []).slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPg = (arr) => Math.ceil((arr || []).length / PER_PAGE);

  return (
    <div data-testid="store-crm-dashboard" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Store CRM</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Customer tracking, refills & staff performance</p>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px] font-body text-sm rounded-sm" data-testid="date-from" />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px] font-body text-sm rounded-sm" data-testid="date-to" />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { l: 'Customers', v: kpis.total_customers, icon: Users, bg: 'bg-sky-50', fg: 'text-sky-600' },
          { l: 'RC Customers', v: kpis.rc_customers, icon: UserCheck, bg: 'bg-rose-50', fg: 'text-rose-600' },
          { l: 'Overdue', v: kpis.overdue, icon: AlertTriangle, bg: 'bg-red-50', fg: 'text-red-600' },
          { l: 'Due Today', v: kpis.due_today, icon: CalendarClock, bg: 'bg-amber-50', fg: 'text-amber-600' },
          { l: 'Due 7 Days', v: kpis.due_7days, icon: Clock, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
          { l: 'New in Range', v: kpis.new_in_range, icon: TrendingUp, bg: 'bg-violet-50', fg: 'text-violet-600' },
        ].map(k => (
          <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[9px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p>
                  <p className="text-xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.v ?? 0}</p>
                </div>
                <div className={`p-1.5 rounded-sm ${k.bg}`}><k.icon className={`w-4 h-4 ${k.fg}`} strokeWidth={1.75} /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="upcoming" className="space-y-4">
        <TabsList className="rounded-sm">
          <TabsTrigger value="upcoming" className="rounded-sm text-xs font-body" data-testid="tab-upcoming">Upcoming Refills ({data?.upcoming_purchases?.length || 0})</TabsTrigger>
          <TabsTrigger value="followups" className="rounded-sm text-xs font-body" data-testid="tab-followups">Follow-ups ({followups.length})</TabsTrigger>
          <TabsTrigger value="rc_purchases" className="rounded-sm text-xs font-body" data-testid="tab-rc-purchases">RC Purchases ({data?.rc_purchases?.length || 0})</TabsTrigger>
          <TabsTrigger value="new_customers" className="rounded-sm text-xs font-body" data-testid="tab-new-customers">New Customers ({data?.new_customers?.length || 0})</TabsTrigger>
          <TabsTrigger value="calls" className="rounded-sm text-xs font-body" data-testid="tab-calls">Call Log ({calls.length})</TabsTrigger>
          <TabsTrigger value="rc_candidates" className="rounded-sm text-xs font-body" data-testid="tab-rc-candidates">RC Candidates ({rcCandidates.length})</TabsTrigger>
          <TabsTrigger value="performance" className="rounded-sm text-xs font-body" data-testid="tab-performance">Staff Performance</TabsTrigger>
        </TabsList>

        {/* Upcoming RC Purchases */}
        <TabsContent value="upcoming">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-380px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Customer', 'Mobile', 'Medicine', 'Qty', 'Due Date', 'Days Left', ''].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!data?.upcoming_purchases?.length) ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12"><CalendarClock className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No upcoming refills</p></TableCell></TableRow>
                  ) : paginate(data.upcoming_purchases, upcomingPage).map(p => (
                    <TableRow key={p.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => navigate(`/crm/customer/${p.customer_id}`)}>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{p.customer_name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{p.mobile}</TableCell>
                      <TableCell className="font-body text-[13px] text-slate-700 flex items-center gap-1.5"><Pill className="w-3.5 h-3.5 text-sky-500" />{p.medicine}</TableCell>
                      <TableCell className="text-[12px] tabular-nums">{p.quantity}</TableCell>
                      <TableCell className="text-[12px] text-slate-500">{p.due_date ? new Date(p.due_date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] rounded-sm ${p.days_until <= 0 ? 'bg-red-100 text-red-700' : p.days_until <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {p.days_until <= 0 ? `${Math.abs(p.days_until)}d overdue` : `${p.days_until}d`}
                        </Badge>
                      </TableCell>
                      <TableCell><ArrowRight className="w-3.5 h-3.5 text-slate-300" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={upcomingPage} totalPages={totalPg(data?.upcoming_purchases)} total={data?.upcoming_purchases?.length || 0} onPageChange={setUpcomingPage} label="refills" />
          </Card>
        </TabsContent>

        {/* Follow-ups */}
        <TabsContent value="followups">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-380px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Date', 'Customer', 'Mobile', 'Type', 'Store', 'Notes', 'Assigned', 'Status', ''].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {followups.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-12"><CalendarClock className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No follow-ups scheduled</p></TableCell></TableRow>
                  ) : paginate(followups, followupPage).map(f => (
                    <TableRow key={f.customer_id} className={`hover:bg-slate-50/50 ${f.overdue ? 'bg-red-50/30' : ''}`}>
                      <TableCell className="text-[12px] font-medium text-slate-700">{f.followup_date ? new Date(f.followup_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-'}</TableCell>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => navigate(`/crm/customer/${f.customer_id}`)}>{f.customer_name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{f.mobile}</TableCell>
                      <TableCell><Badge className={`text-[9px] rounded-sm ${f.customer_type === 'rc' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{f.customer_type}</Badge></TableCell>
                      <TableCell className="text-[12px] text-slate-500">{f.store_name}</TableCell>
                      <TableCell className="text-[11px] text-slate-500 max-w-[200px] truncate">{f.followup_notes || '-'}</TableCell>
                      <TableCell className="text-[11px] text-violet-700 font-medium">{f.assigned_staff || '-'}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] rounded-sm ${f.overdue ? 'bg-red-100 text-red-700' : f.days_until === 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {f.overdue ? `${Math.abs(f.days_until)}d overdue` : f.days_until === 0 ? 'Today' : `In ${f.days_until}d`}
                        </Badge>
                      </TableCell>
                      <TableCell><ArrowRight className="w-3.5 h-3.5 text-slate-300 cursor-pointer" onClick={() => navigate(`/crm/customer/${f.customer_id}`)} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={followupPage} totalPages={totalPg(followups)} total={followups.length} onPageChange={setFollowupPage} label="follow-ups" />
          </Card>
        </TabsContent>

        {/* RC Purchases */}
        <TabsContent value="rc_purchases">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-380px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Customer', 'Medicine', 'Qty', 'Dosage', 'Date', 'Next Due', ''].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!data?.rc_purchases?.length) ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12"><Pill className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No RC purchases in range</p></TableCell></TableRow>
                  ) : paginate(data.rc_purchases, rcPurchasePage).map(p => (
                    <TableRow key={p.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => navigate(`/crm/customer/${p.customer_id}`)}>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{p.customer_name}</TableCell>
                      <TableCell className="font-body text-[13px] text-slate-700">{p.medicine}</TableCell>
                      <TableCell className="text-[12px] tabular-nums">{p.quantity}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{p.dosage || '-'}</TableCell>
                      <TableCell className="text-[12px] text-slate-500">{p.date ? new Date(p.date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell className="text-[12px] text-slate-500">{p.next_due ? new Date(p.next_due).toLocaleDateString() : '-'}</TableCell>
                      <TableCell><ArrowRight className="w-3.5 h-3.5 text-slate-300" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* New Customers */}
        <TabsContent value="new_customers">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <Pagination page={rcPurchasePage} totalPages={totalPg(data?.rc_purchases)} total={data?.rc_purchases?.length || 0} onPageChange={setRcPurchasePage} label="purchases" />
            <div className="overflow-auto max-h-[calc(100vh-380px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Name', 'Mobile', 'Type', 'Joined', ''].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!data?.new_customers?.length) ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12"><Users className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No new customers in range</p></TableCell></TableRow>
                  ) : paginate(data.new_customers, newCustPage).map(c => (
                    <TableRow key={c.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => navigate(`/crm/customer/${c.id}`)}>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{c.name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{c.mobile}</TableCell>
                      <TableCell><Badge className={`text-[10px] rounded-sm ${c.type === 'rc' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{c.type}</Badge></TableCell>
                      <TableCell className="text-[12px] text-slate-500">{c.date ? new Date(c.date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell><ArrowRight className="w-3.5 h-3.5 text-slate-300" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Call Log */}
        <TabsContent value="calls">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <Pagination page={newCustPage} totalPages={totalPg(data?.new_customers)} total={data?.new_customers?.length || 0} onPageChange={setNewCustPage} label="customers" />
            <div className="overflow-auto max-h-[calc(100vh-380px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Customer', 'Mobile', 'Called By', 'Result', 'Remarks', 'Date'].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12"><Phone className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No calls logged yet</p></TableCell></TableRow>
                  ) : paginate(calls, callPage).map(cl => {
                    const resultColor = { reached: 'bg-sky-50 text-sky-700', confirmed: 'bg-emerald-50 text-emerald-700', not_reachable: 'bg-red-50 text-red-700', callback: 'bg-amber-50 text-amber-700', discontinued: 'bg-slate-100 text-slate-600' };
                    return (
                      <TableRow key={cl.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => navigate(`/crm/customer/${cl.customer_id}`)}>
                        <TableCell className="font-body text-[13px] font-medium text-slate-800">{cl.customer_name}</TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-500">{cl.mobile_number}</TableCell>
                        <TableCell className="font-body text-[13px] font-medium text-violet-700">{cl.caller_name || '-'}</TableCell>
                        <TableCell><Badge className={`text-[10px] rounded-sm ${resultColor[cl.call_result] || 'bg-slate-100 text-slate-600'}`}>{cl.call_result?.replace('_', ' ')}</Badge></TableCell>
                        <TableCell className="text-[11px] text-slate-500 max-w-[200px] truncate">{cl.remarks || '-'}</TableCell>
                        <TableCell className="text-[11px] text-slate-400">{cl.created_at ? new Date(cl.created_at).toLocaleString() : '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* RC Candidates */}
        <TabsContent value="rc_candidates">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <Pagination page={callPage} totalPages={totalPg(calls)} total={calls.length} onPageChange={setCallPage} label="calls" />
            <div className="overflow-auto max-h-[calc(100vh-380px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Customer', 'Mobile', 'Store', 'Repeat Medicines', 'Total Purchases', 'Total Spent', 'Action'].map(h => (
                      <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Total Purchases', 'Total Spent'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rcCandidates.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12"><UserCheck className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No walk-in customers with repeat purchases found</p></TableCell></TableRow>
                  ) : paginate(rcCandidates, rcCandPage).map(c => (
                    <TableRow key={c.customer_id} className="hover:bg-slate-50/50">
                      <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => openCandidateDetail(c)}>{c.customer_name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{c.mobile}</TableCell>
                      <TableCell className="text-[12px] text-slate-500">{c.store_name}</TableCell>
                      <TableCell>
                        <div className="space-y-1 max-w-[280px]">
                          {c.repeat_medicines.slice(0, 3).map((m, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-[11px] font-body">
                              <Pill className="w-3 h-3 text-sky-500 shrink-0" />
                              <span className="text-slate-700 truncate">{m.medicine}</span>
                              <Badge className="text-[8px] rounded-sm bg-sky-50 text-sky-700 shrink-0">{m.count}x</Badge>
                              {m.avg_interval > 0 && <span className="text-slate-400 text-[9px] shrink-0">~{m.avg_interval}d</span>}
                            </div>
                          ))}
                          {c.repeat_medicines.length > 3 && <span className="text-[9px] text-slate-400">+{c.repeat_medicines.length - 3} more</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums font-bold text-sky-700">{c.total_repeat_purchases}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {c.total_spent.toLocaleString('en-IN')}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] font-body text-rose-600 border-rose-200 hover:bg-rose-50"
                            onClick={() => { api.put(`/crm/customers/${c.customer_id}/type`, { customer_type: 'rc' }).then(() => { toast.success(`${c.customer_name} converted to RC`); loadRcCandidates(); }).catch(() => toast.error('Failed')); }}>
                            Convert to RC
                          </Button>
                          <FollowupButton customerId={c.customer_id} customerName={c.customer_name} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={rcCandPage} totalPages={totalPg(rcCandidates)} total={rcCandidates.length} onPageChange={setRcCandPage} label="candidates" />
          </Card>
        </TabsContent>

        {/* Staff Performance */}
        <TabsContent value="performance">
          <div className="flex items-center gap-3 mb-3">
            <Select value={perfDays} onValueChange={setPerfDays}>
              <SelectTrigger className="w-[160px] rounded-sm font-body text-sm" data-testid="perf-period"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-2 border-slate-100">
                    {['Staff', 'Role', 'Assigned RC', 'Calls', 'Confirmed', 'Conversion %', 'Overdue Refills', 'Tasks Done'].map(h => (
                      <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Assigned RC', 'Calls', 'Confirmed', 'Conversion %', 'Overdue Refills', 'Tasks Done'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!perf?.staff?.length) ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12"><Users className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No store staff found</p></TableCell></TableRow>
                  ) : perf.staff.map(s => (
                    <TableRow key={s.staff_id} className="hover:bg-slate-50/50">
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.name}</TableCell>
                      <TableCell><Badge className={`text-[10px] rounded-sm ${s.role === 'STORE_MANAGER' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>{s.role.replace('_', ' ')}</Badge></TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums font-medium">{s.assigned_customers}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">{s.calls_made}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums text-emerald-700">{s.confirmed_calls}</TableCell>
                      <TableCell className="text-right">
                        <Badge className={`text-[10px] rounded-sm tabular-nums ${s.conversion_rate >= 50 ? 'bg-emerald-50 text-emerald-700' : s.conversion_rate >= 20 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{s.conversion_rate}%</Badge>
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums"><span className={s.overdue_refills > 0 ? 'text-red-600 font-medium' : 'text-slate-500'}>{s.overdue_refills}</span></TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">{s.tasks_completed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* RC Candidate Detail Popup */}
      <Dialog open={!!candidateDetail || detailLoading} onOpenChange={v => { if (!v) { setCandidateDetail(null); } }}>
        <DialogContent className="rounded-sm max-w-2xl max-h-[85vh] overflow-auto p-0">
          {detailLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 text-sky-500 animate-spin mx-auto" /><p className="text-sm text-slate-400 mt-2">Loading...</p></div>
          ) : candidateDetail?.profile ? (() => {
            const p = candidateDetail.profile;
            const s = candidateDetail.stats;
            const rc = candidateDetail.rc_info;
            const resultColor = { reached: 'bg-sky-50 text-sky-700', confirmed: 'bg-emerald-50 text-emerald-700', not_reachable: 'bg-red-50 text-red-700', callback: 'bg-amber-50 text-amber-700', discontinued: 'bg-slate-100 text-slate-600' };
            return (
              <>
                <DialogHeader className="px-5 pt-5 pb-0"><DialogTitle className="font-heading">{p.customer_name}</DialogTitle></DialogHeader>
                <div className="px-5 pb-5 space-y-4">
                  {/* Profile + Stats */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5 text-[12px] font-body">
                      <div><span className="text-slate-400">Mobile:</span> <span className="font-medium">{p.mobile_number}</span></div>
                      <div><span className="text-slate-400">Store:</span> <span className="font-medium">{p.store_name}</span></div>
                      <Badge className="text-[9px] rounded-sm bg-slate-100 text-slate-600">{p.customer_type}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { l: 'Total Spent', v: `INR ${s.total_spent.toLocaleString('en-IN')}`, c: 'text-emerald-700' },
                        { l: 'Invoices', v: s.total_invoices, c: 'text-sky-700' },
                        { l: 'Items', v: s.total_items, c: 'text-slate-800' },
                        { l: 'Repeat Meds', v: rc?.repeat_medicines?.length || 0, c: 'text-violet-700' },
                      ].map(k => (
                        <div key={k.l} className="p-2 bg-slate-50 rounded-sm"><p className="text-[8px] text-slate-400 uppercase">{k.l}</p><p className={`text-[14px] font-bold tabular-nums ${k.c}`}>{k.v}</p></div>
                      ))}
                    </div>
                  </div>

                  {/* Repeat Medicines */}
                  {rc?.repeat_medicines?.length > 0 && (
                    <div className="p-3 bg-violet-50/50 border border-violet-200 rounded-sm">
                      <p className="text-[10px] font-body text-violet-700 uppercase tracking-wider mb-1.5">Repeat Medicines (Last 90 Days)</p>
                      {rc.repeat_medicines.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 py-1 text-[11px] font-body border-b border-violet-100 last:border-0">
                          <Pill className="w-3 h-3 text-violet-500" />
                          <span className="font-medium">{m.medicine}</span>
                          <Badge className="text-[8px] rounded-sm bg-violet-100 text-violet-700">{m.count}x</Badge>
                          <span className="text-slate-400 ml-auto">INR {m.spent}</span>
                          {m.avg_interval > 0 && <span className="text-slate-400">~{m.avg_interval}d</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recent Purchases */}
                  {candidateDetail.recent_invoices?.length > 0 && (
                    <div className="p-3 border border-slate-200 rounded-sm">
                      <p className="text-[10px] font-body text-sky-700 uppercase tracking-wider mb-1.5"><Receipt className="w-3 h-3 inline mr-1" />Recent Invoices</p>
                      <div className="max-h-[150px] overflow-auto space-y-1.5">
                        {candidateDetail.recent_invoices.map((inv, i) => (
                          <div key={i} className="flex justify-between text-[11px] font-body border-b border-slate-50 pb-1">
                            <span>#{inv.entry_number} | {inv.date ? new Date(inv.date).toLocaleDateString() : '-'} | {inv.items.length} items</span>
                            <span className="font-medium text-emerald-700">INR {inv.total.toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Active Medicines / Refills */}
                  {candidateDetail.active_medicines?.length > 0 && (
                    <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-sm">
                      <p className="text-[10px] font-body text-emerald-700 uppercase tracking-wider mb-1.5">Active Refills</p>
                      {candidateDetail.active_medicines.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 py-1 text-[11px] font-body">
                          <Pill className="w-3 h-3 text-emerald-500" /><span className="font-medium">{m.medicine}</span>
                          {m.next_due && <Badge className="text-[8px] rounded-sm bg-amber-50 text-amber-700 ml-auto">Due: {new Date(m.next_due).toLocaleDateString()}</Badge>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Call History */}
                  {candidateDetail.call_history?.length > 0 && (
                    <div className="p-3 border border-slate-200 rounded-sm">
                      <p className="text-[10px] font-body text-slate-600 uppercase tracking-wider mb-1.5"><Phone className="w-3 h-3 inline mr-1" />Call History</p>
                      <div className="max-h-[120px] overflow-auto space-y-1">
                        {candidateDetail.call_history.map((cl, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px] font-body border-b border-slate-50 pb-1">
                            <Badge className={`text-[8px] rounded-sm ${resultColor[cl.result] || 'bg-slate-100'}`}>{cl.result?.replace('_', ' ')}</Badge>
                            <span className="text-violet-700 font-medium">{cl.caller}</span>
                            <span className="text-slate-400 truncate flex-1">{cl.remarks || '-'}</span>
                            <span className="text-slate-300 text-[9px] shrink-0">{cl.date ? new Date(cl.date).toLocaleDateString() : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2 border-t border-slate-200">
                    <Button size="sm" className="bg-rose-500 hover:bg-rose-600 rounded-sm text-xs font-body"
                      onClick={() => { api.put(`/crm/customers/${p.id}/type`, { customer_type: 'rc' }).then(() => { toast.success('Converted to RC'); setCandidateDetail(null); loadRcCandidates(); }).catch(() => toast.error('Failed')); }}>
                      <UserCheck className="w-3 h-3 mr-1" /> Convert to RC
                    </Button>
                    <FollowupButton customerId={p.id} customerName={p.customer_name} onDone={() => { setCandidateDetail(null); loadFollowups(); }} />
                    <Button size="sm" variant="outline" className="rounded-sm text-xs font-body ml-auto" onClick={() => { setCandidateDetail(null); navigate(`/crm/customer/${p.id}`); }}>
                      <ArrowRight className="w-3 h-3 mr-1" /> Full Profile
                    </Button>
                  </div>
                </div>
              </>
            );
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
