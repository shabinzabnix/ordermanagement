import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Phone, TrendingUp, Users, AlertTriangle, BarChart3, Receipt, IndianRupee, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#10B981', '#F59E0B', '#E11D48', '#0EA5E9', '#8B5CF6'];

export default function CRMReportsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isHO = ['ADMIN', 'HO_STAFF', 'DIRECTOR'].includes(user?.role);
  const [perf, setPerf] = useState(null);
  const [adherence, setAdherence] = useState(null);
  const [days, setDays] = useState('30');
  const [loading, setLoading] = useState(true);
  // Daily invoices state
  const [invoices, setInvoices] = useState([]);
  const [invTotal, setInvTotal] = useState(0);
  const [invSummary, setInvSummary] = useState({});
  const [invDate, setInvDate] = useState(new Date().toISOString().split('T')[0]);
  const [invPage, setInvPage] = useState(1);
  const [stores, setStores] = useState([]);
  const isStore = ['STORE_STAFF', 'STORE_MANAGER'].includes(user?.role);
  const [invStore, setInvStore] = useState(isStore && user?.store_id ? String(user.store_id) : 'all');
  const invLimit = 50;

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/crm/reports/performance', { params: { days: parseInt(days) } }),
      api.get('/crm/adherence'),
    ]).then(([p, a]) => { setPerf(p.data); setAdherence(a.data); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    const params = { date: invDate, page: invPage, limit: invLimit };
    if (invStore !== 'all') params.store_id = invStore;
    api.get('/crm/daily-invoices', { params })
      .then(r => { setInvoices(r.data.invoices); setInvTotal(r.data.total); setInvSummary(r.data.summary || {}); })
      .catch(() => {});
  }, [invDate, invPage, invStore]);

  const prevDay = () => { const d = new Date(invDate); d.setDate(d.getDate() - 1); setInvDate(d.toISOString().split('T')[0]); setInvPage(1); };
  const nextDay = () => { const d = new Date(invDate); d.setDate(d.getDate() + 1); if (d <= new Date()) { setInvDate(d.toISOString().split('T')[0]); setInvPage(1); } };

  const callData = perf?.call_results ? Object.entries(perf.call_results).map(([k, v]) => ({ name: k.replace('_', ' '), value: v })) : [];
  const storeData = perf?.store_report || [];
  const adhSummary = adherence?.summary || { high: 0, medium: 0, low: 0 };
  const adhPie = [{ name: 'High', value: adhSummary.high }, { name: 'Medium', value: adhSummary.medium }, { name: 'Low', value: adhSummary.low }].filter(d => d.value > 0);
  const invTotalPages = Math.ceil(invTotal / invLimit);
  const typeBadge = { rc: 'bg-rose-100 text-rose-700', chronic: 'bg-violet-100 text-violet-700', high_value: 'bg-amber-100 text-amber-700', walkin: 'bg-slate-100 text-slate-600' };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (<div className="bg-white border border-slate-200 rounded-sm p-2.5 shadow-md">
      <p className="text-[11px] font-heading font-semibold text-slate-700 mb-1">{label || payload[0]?.name}</p>
      {payload.map((p, i) => <p key={i} className="text-[11px] font-body text-slate-500">{p.name || p.dataKey}: <span className="font-medium text-slate-800">{p.value}</span></p>)}
    </div>);
  };

  return (
    <div data-testid="crm-reports-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">CRM Reports</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Performance, adherence & daily invoices</p>
        </div>
      </div>

      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList className="rounded-sm">
          <TabsTrigger value="performance" className="rounded-sm text-xs font-body">Performance</TabsTrigger>
          <TabsTrigger value="invoices" className="rounded-sm text-xs font-body">Daily Invoices ({invTotal})</TabsTrigger>
        </TabsList>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-5">
          <div className="flex justify-end">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[140px] font-body text-sm rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem></SelectContent>
            </Select>
          </div>

          {loading ? <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-sm" />)}</div> : (<>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Calls', value: perf?.total_calls || 0, icon: Phone, bg: 'bg-violet-50', fg: 'text-violet-600' },
              { label: 'Conversion Rate', value: `${perf?.conversion_rate || 0}%`, icon: TrendingUp, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
              { label: 'Sales Imported', value: perf?.total_sales_imported || 0, icon: BarChart3, bg: 'bg-sky-50', fg: 'text-sky-600' },
              { label: 'Pending Med Updates', value: perf?.pending_medication_updates || 0, icon: AlertTriangle, bg: 'bg-amber-50', fg: 'text-amber-600' },
            ].map(k => (
              <Card key={k.label} className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-4">
                <div className="flex items-start justify-between"><div><p className="text-[10px] font-body text-slate-400 uppercase tracking-wider">{k.label}</p><p className="text-xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.value}</p></div>
                <div className={`p-2 rounded-sm ${k.bg}`}><k.icon className={`w-4 h-4 ${k.fg}`} strokeWidth={1.75} /></div></div>
              </CardContent></Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-slate-200 shadow-sm rounded-sm">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Call Results</CardTitle></CardHeader>
              <CardContent>{callData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}><BarChart data={callData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} /><YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} /><Tooltip content={<CustomTooltip />} /><Bar dataKey="value" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
                </BarChart></ResponsiveContainer>
              ) : <div className="flex items-center justify-center h-[200px] text-xs text-slate-400">No call data</div>}</CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm rounded-sm">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Adherence</CardTitle></CardHeader>
              <CardContent>{adhPie.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={adhPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" paddingAngle={2}>
                  {adhPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip content={<CustomTooltip />} /></PieChart></ResponsiveContainer>
              ) : <div className="flex items-center justify-center h-[200px] text-xs text-slate-400">No adherence data</div>}
              <div className="flex justify-center gap-4 mt-2">{[{ l: 'High', c: 'text-emerald-600', v: adhSummary.high }, { l: 'Medium', c: 'text-amber-600', v: adhSummary.medium }, { l: 'Low', c: 'text-red-600', v: adhSummary.low }].map(a => (
                <span key={a.l} className={`text-[11px] font-body ${a.c} font-medium`}>{a.l}: {a.v}</span>))}</div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-slate-400" /> Store-wise Retention</CardTitle></CardHeader>
            <div className="overflow-auto"><Table><TableHeader><TableRow className="border-b-2 border-slate-100">
              {['Store', 'Total Customers', 'RC Customers', 'Retention %', 'Overdue'].map(h => (
                <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${h !== 'Store' ? 'text-right' : ''}`}>{h}</TableHead>))}
            </TableRow></TableHeader><TableBody>
              {storeData.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-12"><Users className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400">No store data</p></TableCell></TableRow> :
              storeData.map(s => (<TableRow key={s.store_id} className="hover:bg-slate-50/50">
                <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.store_name}</TableCell>
                <TableCell className="text-right text-[12px] tabular-nums">{s.total_customers}</TableCell>
                <TableCell className="text-right text-[12px] tabular-nums">{s.rc_customers}</TableCell>
                <TableCell className="text-right"><span className={`text-[12px] tabular-nums font-medium ${s.retention_pct >= 30 ? 'text-emerald-600' : s.retention_pct >= 15 ? 'text-amber-600' : 'text-red-600'}`}>{s.retention_pct}%</span></TableCell>
                <TableCell className="text-right text-[12px] tabular-nums">{s.overdue}</TableCell>
              </TableRow>))}
            </TableBody></Table></div>
          </Card>
          </>)}
        </TabsContent>

        {/* Daily Invoices Tab */}
        <TabsContent value="invoices" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-sm" onClick={prevDay}><ChevronLeft className="w-4 h-4" /></Button>
              <Input type="date" value={invDate} onChange={e => { setInvDate(e.target.value); setInvPage(1); }} className="w-[160px] font-body text-sm rounded-sm h-8" />
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-sm" onClick={nextDay}><ChevronRight className="w-4 h-4" /></Button>
            </div>
            {isHO && (
              <Select value={invStore} onValueChange={v => { setInvStore(v); setInvPage(1); }}>
                <SelectTrigger className="w-[180px] font-body text-sm rounded-sm h-8"><SelectValue placeholder="All Stores" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { l: 'Total Sales', v: `INR ${(invSummary.total_amount || 0).toLocaleString('en-IN')}`, icon: IndianRupee, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
              { l: 'Invoices', v: invSummary.total_invoices || 0, icon: Receipt, bg: 'bg-sky-50', fg: 'text-sky-600' },
              { l: 'Customers', v: invSummary.total_customers || 0, icon: Users, bg: 'bg-violet-50', fg: 'text-violet-600' },
            ].map(k => (
              <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-3">
                <div className="flex items-center gap-3"><div className={`p-2 rounded-sm ${k.bg}`}><k.icon className={`w-4 h-4 ${k.fg}`} strokeWidth={1.75} /></div>
                <div><p className="text-[9px] font-body text-slate-400 uppercase">{k.l}</p><p className="text-xl font-heading font-bold text-slate-900 tabular-nums">{k.v}</p></div></div>
              </CardContent></Card>
            ))}
          </div>

          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-420px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
                  {['Store', 'Invoice #', 'Customer', 'Mobile', 'Type', 'Items', 'Amount', ''].map(h => (
                    <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Items', 'Amount'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>))}
                </TableRow></TableHeader>
                <TableBody>
                  {invoices.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-16"><Receipt className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No invoices</p></TableCell></TableRow>
                  ) : invoices.map((inv, i) => (
                    <TableRow key={`${inv.entry_number}-${i}`} className="hover:bg-slate-50/50">
                      <TableCell className="text-[12px] font-medium text-sky-700">{inv.store_name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{inv.entry_number || '-'}</TableCell>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => inv.customer_id && navigate(`/crm/customer/${inv.customer_id}`)}>{inv.customer_name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{inv.mobile}</TableCell>
                      <TableCell><Badge className={`text-[9px] rounded-sm ${typeBadge[inv.customer_type] || 'bg-slate-100 text-slate-600'}`}>{inv.customer_type}</Badge></TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{inv.item_count}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums font-medium text-emerald-700">INR {inv.total_amount.toLocaleString('en-IN')}</TableCell>
                      <TableCell>{inv.customer_id && <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigate(`/crm/customer/${inv.customer_id}`)}><ArrowRight className="w-3.5 h-3.5 text-slate-400" /></Button>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {invTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
                <p className="text-[11px] text-slate-400 font-body">Page {invPage}/{invTotalPages} | {invTotal} invoices</p>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setInvPage(p => Math.max(1, p-1))} disabled={invPage === 1} className="h-7 w-7 p-0 rounded-sm"><ChevronLeft className="w-3.5 h-3.5" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setInvPage(p => Math.min(invTotalPages, p+1))} disabled={invPage === invTotalPages} className="h-7 w-7 p-0 rounded-sm"><ChevronRight className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
