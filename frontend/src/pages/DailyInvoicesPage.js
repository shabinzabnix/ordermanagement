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
import { toast } from 'sonner';
import { Receipt, Users, ChevronLeft, ChevronRight, IndianRupee, ArrowRight } from 'lucide-react';

export default function DailyInvoicesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const limit = 50;
  const isHO = ['ADMIN', 'HO_STAFF', 'DIRECTOR'].includes(user?.role);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { date, page, limit };
    if (storeFilter !== 'all') params.store_id = storeFilter;
    api.get('/crm/daily-invoices', { params })
      .then(r => { setInvoices(r.data.invoices); setTotal(r.data.total); setSummary(r.data.summary || {}); })
      .catch(() => toast.error('Failed'))
      .finally(() => setLoading(false));
  }, [date, page, storeFilter]);

  const prevDay = () => { const d = new Date(date); d.setDate(d.getDate() - 1); setDate(d.toISOString().split('T')[0]); setPage(1); };
  const nextDay = () => { const d = new Date(date); d.setDate(d.getDate() + 1); if (d <= new Date()) { setDate(d.toISOString().split('T')[0]); setPage(1); } };

  const totalPages = Math.ceil(total / limit);
  const typeBadge = { rc: 'bg-rose-100 text-rose-700', chronic: 'bg-violet-100 text-violet-700', high_value: 'bg-amber-100 text-amber-700', walkin: 'bg-slate-100 text-slate-600' };

  return (
    <div data-testid="daily-invoices-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Daily Invoices</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{new Date(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-sm" onClick={prevDay}><ChevronLeft className="w-4 h-4" /></Button>
          <Input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(1); }} className="w-[160px] font-body text-sm rounded-sm h-8" />
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-sm" onClick={nextDay}><ChevronRight className="w-4 h-4" /></Button>
          {isHO && (
            <Select value={storeFilter} onValueChange={v => { setStoreFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px] font-body text-sm rounded-sm h-8"><SelectValue placeholder="All Stores" /></SelectTrigger>
              <SelectContent>{!['STORE_STAFF','STORE_MANAGER'].includes(user?.role) && <SelectItem value="all">All Stores</SelectItem>}{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { l: 'Total Sales', v: `INR ${(summary.total_amount || 0).toLocaleString('en-IN')}`, icon: IndianRupee, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
          { l: 'Invoices', v: summary.total_invoices || 0, icon: Receipt, bg: 'bg-sky-50', fg: 'text-sky-600' },
          { l: 'Customers', v: summary.total_customers || 0, icon: Users, bg: 'bg-violet-50', fg: 'text-violet-600' },
        ].map(k => (
          <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-sm ${k.bg}`}><k.icon className={`w-4 h-4 ${k.fg}`} strokeWidth={1.75} /></div>
                <div><p className="text-[9px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p><p className="text-xl font-heading font-bold text-slate-900 tabular-nums">{k.v}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-320px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Store', 'Invoice #', 'Customer', 'Mobile', 'Type', 'Items', 'Amount', ''].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Items', 'Amount'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? [...Array(5)].map((_, i) => <TableRow key={i}>{[...Array(8)].map((_, j) => <TableCell key={j}><div className="h-4 bg-slate-50 rounded animate-pulse" /></TableCell>)}</TableRow>) :
               invoices.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16"><Receipt className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No invoices on this day</p></TableCell></TableRow>
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
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} | {total} invoices</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="h-7 w-7 p-0 rounded-sm"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages} className="h-7 w-7 p-0 rounded-sm"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
