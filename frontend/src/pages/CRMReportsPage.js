import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Phone, TrendingUp, Users, AlertTriangle, CheckCircle, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#10B981', '#F59E0B', '#E11D48', '#0EA5E9', '#8B5CF6'];

export default function CRMReportsPage() {
  const [perf, setPerf] = useState(null);
  const [adherence, setAdherence] = useState(null);
  const [days, setDays] = useState('30');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/crm/reports/performance', { params: { days: parseInt(days) } }),
      api.get('/crm/adherence'),
    ]).then(([p, a]) => { setPerf(p.data); setAdherence(a.data); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [days]);

  if (loading) return <div className="space-y-4"><div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-sm" />)}</div></div>;

  const callData = perf?.call_results ? Object.entries(perf.call_results).map(([k, v]) => ({ name: k.replace('_', ' '), value: v })) : [];
  const storeData = perf?.store_report || [];
  const adhSummary = adherence?.summary || { high: 0, medium: 0, low: 0 };
  const adhPie = [
    { name: 'High', value: adhSummary.high },
    { name: 'Medium', value: adhSummary.medium },
    { name: 'Low', value: adhSummary.low },
  ].filter(d => d.value > 0);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-sm p-2.5 shadow-md">
        <p className="text-[11px] font-heading font-semibold text-slate-700 mb-1">{label || payload[0]?.name}</p>
        {payload.map((p, i) => <p key={i} className="text-[11px] font-body text-slate-500">{p.name || p.dataKey}: <span className="font-medium text-slate-800">{p.value}</span></p>)}
      </div>
    );
  };

  return (
    <div data-testid="crm-reports-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">CRM Performance Reports</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Call conversion, retention & adherence analytics</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[140px] font-body text-sm rounded-sm" data-testid="period-select"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem></SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Calls', value: perf?.total_calls || 0, icon: Phone, bg: 'bg-violet-50', fg: 'text-violet-600' },
          { label: 'Conversion Rate', value: `${perf?.conversion_rate || 0}%`, icon: TrendingUp, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
          { label: 'Sales Imported', value: perf?.total_sales_imported || 0, icon: BarChart3, bg: 'bg-sky-50', fg: 'text-sky-600' },
          { label: 'Pending Med Updates', value: perf?.pending_medication_updates || 0, icon: AlertTriangle, bg: 'bg-amber-50', fg: 'text-amber-600' },
        ].map(k => (
          <Card key={k.label} className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div><p className="text-[10px] font-body text-slate-400 uppercase tracking-wider">{k.label}</p>
                  <p className="text-xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.value}</p></div>
                <div className={`p-2 rounded-sm ${k.bg}`}><k.icon className={`w-4 h-4 ${k.fg}`} strokeWidth={1.75} /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Call Results Breakdown</CardTitle></CardHeader>
          <CardContent>
            {callData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={callData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                  <YAxis tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-[200px] text-xs text-slate-400 font-body">No call data for this period</div>}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Patient Adherence Distribution</CardTitle></CardHeader>
          <CardContent>
            {adhPie.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={adhPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" paddingAngle={2}>
                    {adhPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-[200px] text-xs text-slate-400 font-body">No adherence data</div>}
            <div className="flex justify-center gap-4 mt-2">
              {[{ l: 'High', c: 'text-emerald-600', v: adhSummary.high }, { l: 'Medium', c: 'text-amber-600', v: adhSummary.medium }, { l: 'Low', c: 'text-red-600', v: adhSummary.low }].map(a => (
                <span key={a.l} className={`text-[11px] font-body ${a.c} font-medium`}>{a.l}: {a.v}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-slate-400" /> Store-wise Customer Retention</CardTitle></CardHeader>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-slate-100">
                {['Store', 'Total Customers', 'RC Customers', 'Retention %', 'Overdue'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Total Customers', 'RC Customers', 'Retention %', 'Overdue'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {storeData.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12"><Users className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400 font-body">No store data</p></TableCell></TableRow>
              ) : storeData.map(s => (
                <TableRow key={s.store_id} className="hover:bg-slate-50/50">
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.store_name}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{s.total_customers}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{s.rc_customers}</TableCell>
                  <TableCell className="text-right">
                    <span className={`text-[12px] tabular-nums font-medium ${s.retention_pct >= 30 ? 'text-emerald-600' : s.retention_pct >= 15 ? 'text-amber-600' : 'text-red-600'}`}>{s.retention_pct}%</span>
                  </TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{s.overdue}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
