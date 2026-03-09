import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { Phone, Users, RefreshCw, Pill, Upload, ChevronLeft, ChevronRight, UserCheck, CheckCircle, Clock, FileText } from 'lucide-react';

export default function DailyReportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const isHO = ['ADMIN', 'HO_STAFF', 'DIRECTOR'].includes(user?.role);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { date };
    if (storeFilter !== 'all') params.store_id = storeFilter;
    api.get('/crm/daily-report', { params })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, [date, storeFilter]);

  const prevDay = () => {
    const d = new Date(date); d.setDate(d.getDate() - 1); setDate(d.toISOString().split('T')[0]);
  };
  const nextDay = () => {
    const d = new Date(date); d.setDate(d.getDate() + 1);
    if (d <= new Date()) setDate(d.toISOString().split('T')[0]);
  };

  const s = data?.summary || {};
  const resultColor = { reached: 'bg-sky-50 text-sky-700', confirmed: 'bg-emerald-50 text-emerald-700', not_reachable: 'bg-red-50 text-red-700', callback: 'bg-amber-50 text-amber-700', discontinued: 'bg-slate-100 text-slate-600' };

  return (
    <div data-testid="daily-report-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Daily CRM Report</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Complete activity log for {new Date(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-sm" onClick={prevDay} data-testid="prev-day"><ChevronLeft className="w-4 h-4" /></Button>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-[160px] font-body text-sm rounded-sm h-8" data-testid="report-date" />
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-sm" onClick={nextDay} data-testid="next-day"><ChevronRight className="w-4 h-4" /></Button>
          {isHO && (
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[180px] font-body text-sm rounded-sm h-8"><SelectValue placeholder="All Stores" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(st => <SelectItem key={st.id} value={String(st.id)}>{st.store_name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          { l: 'Calls', v: s.total_calls, icon: Phone, bg: 'bg-violet-50', fg: 'text-violet-600' },
          { l: 'Confirmed', v: s.confirmed, icon: CheckCircle, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
          { l: 'New Customers', v: s.new_customers, icon: Users, bg: 'bg-sky-50', fg: 'text-sky-600' },
          { l: 'Conversions', v: s.conversions, icon: RefreshCw, bg: 'bg-rose-50', fg: 'text-rose-600' },
          { l: 'Meds Added', v: s.medicines_added, icon: Pill, bg: 'bg-amber-50', fg: 'text-amber-600' },
          { l: 'Uploads', v: s.uploads, icon: Upload, bg: 'bg-teal-50', fg: 'text-teal-600' },
          { l: 'Tasks Done', v: s.tasks_completed, icon: FileText, bg: 'bg-slate-50', fg: 'text-slate-600' },
        ].map(k => (
          <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-2.5">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-sm ${k.bg}`}><k.icon className={`w-3.5 h-3.5 ${k.fg}`} strokeWidth={1.75} /></div>
                <div>
                  <p className="text-[9px] font-body text-slate-400 uppercase tracking-wider leading-none">{k.l}</p>
                  <p className="text-lg font-heading font-bold text-slate-900 tabular-nums leading-tight">{k.v ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Call Results Breakdown */}
      {Object.keys(s.call_results || {}).length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(s.call_results).map(([k, v]) => (
            <Badge key={k} className={`text-[11px] rounded-sm px-2.5 py-1 ${resultColor[k] || 'bg-slate-100 text-slate-600'}`}>
              {k.replace('_', ' ')}: {v}
            </Badge>
          ))}
        </div>
      )}

      <Tabs defaultValue="calls" className="space-y-4">
        <TabsList className="rounded-sm">
          <TabsTrigger value="calls" className="rounded-sm text-xs font-body" data-testid="tab-calls">Calls ({data?.calls?.length || 0})</TabsTrigger>
          <TabsTrigger value="staff" className="rounded-sm text-xs font-body" data-testid="tab-staff">Staff Activity ({data?.staff_summary?.length || 0})</TabsTrigger>
          <TabsTrigger value="new" className="rounded-sm text-xs font-body" data-testid="tab-new">New Customers ({data?.new_customers?.length || 0})</TabsTrigger>
          <TabsTrigger value="meds" className="rounded-sm text-xs font-body" data-testid="tab-meds">Medicines ({data?.medicines_added?.length || 0})</TabsTrigger>
        </TabsList>

        {/* Calls Detail */}
        <TabsContent value="calls">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-440px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
                  {['Time', 'Customer', 'Mobile', 'Called By', 'Result', 'Remarks'].map(h => (
                    <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                  ))}
                </TableRow></TableHeader>
                <TableBody>
                  {!data?.calls?.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12"><Phone className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No calls on this day</p></TableCell></TableRow>
                  ) : data.calls.map(cl => (
                    <TableRow key={cl.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-[12px] text-slate-500 w-[60px]">{cl.time}</TableCell>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => navigate(`/crm/customer/${cl.customer_id}`)}>{cl.customer_name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{cl.mobile}</TableCell>
                      <TableCell className="font-body text-[13px] font-medium text-violet-700">{cl.caller_name}</TableCell>
                      <TableCell><Badge className={`text-[10px] rounded-sm ${resultColor[cl.call_result] || 'bg-slate-100 text-slate-600'}`}>{cl.call_result?.replace('_', ' ')}</Badge></TableCell>
                      <TableCell className="text-[11px] text-slate-500 max-w-[250px] truncate">{cl.remarks || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Staff Activity */}
        <TabsContent value="staff">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto">
              <Table>
                <TableHeader><TableRow className="border-b-2 border-slate-100">
                  {['Staff Name', 'Total Calls', 'Reached', 'Confirmed', 'Conversion %'].map(h => (
                    <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${h !== 'Staff Name' ? 'text-right' : ''}`}>{h}</TableHead>
                  ))}
                </TableRow></TableHeader>
                <TableBody>
                  {!data?.staff_summary?.length ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12"><UserCheck className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No staff activity</p></TableCell></TableRow>
                  ) : data.staff_summary.map((s, i) => {
                    const rate = s.calls > 0 ? Math.round(s.confirmed / s.calls * 100) : 0;
                    return (
                      <TableRow key={i} className="hover:bg-slate-50/50">
                        <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.name}</TableCell>
                        <TableCell className="text-right text-[13px] tabular-nums font-bold">{s.calls}</TableCell>
                        <TableCell className="text-right text-[13px] tabular-nums text-sky-700">{s.reached}</TableCell>
                        <TableCell className="text-right text-[13px] tabular-nums text-emerald-700">{s.confirmed}</TableCell>
                        <TableCell className="text-right">
                          <Badge className={`text-[10px] rounded-sm tabular-nums ${rate >= 50 ? 'bg-emerald-50 text-emerald-700' : rate > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-400'}`}>{rate}%</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* New Customers */}
        <TabsContent value="new">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-440px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
                  {['Time', 'Customer', 'Mobile', 'Type', 'Store'].map(h => (
                    <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                  ))}
                </TableRow></TableHeader>
                <TableBody>
                  {!data?.new_customers?.length ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12"><Users className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No new customers</p></TableCell></TableRow>
                  ) : data.new_customers.map(c => (
                    <TableRow key={c.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => navigate(`/crm/customer/${c.id}`)}>
                      <TableCell className="font-mono text-[12px] text-slate-500 w-[60px]">{c.time}</TableCell>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{c.name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">{c.mobile}</TableCell>
                      <TableCell><Badge className={`text-[9px] rounded-sm ${c.type === 'rc' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{c.type}</Badge></TableCell>
                      <TableCell className="text-[12px] text-slate-500">{c.store}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Medicines Added */}
        <TabsContent value="meds">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-440px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
                  {['Time', 'Customer', 'Medicine', 'Dosage', 'Timing', 'Days'].map(h => (
                    <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3">{h}</TableHead>
                  ))}
                </TableRow></TableHeader>
                <TableBody>
                  {!data?.medicines_added?.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12"><Pill className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No medicines added</p></TableCell></TableRow>
                  ) : data.medicines_added.map(m => (
                    <TableRow key={m.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-[12px] text-slate-500 w-[60px]">{m.time}</TableCell>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{m.customer_name}</TableCell>
                      <TableCell className="font-body text-[13px] text-slate-700">{m.medicine}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{m.dosage || '-'}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{m.timing || '-'}</TableCell>
                      <TableCell className="text-[12px] tabular-nums">{m.days || '-'}d</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
