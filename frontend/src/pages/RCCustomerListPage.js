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
import { UserCheck, Search, ChevronLeft, ChevronRight, ArrowRight, Pill, AlertTriangle, Building2 } from 'lucide-react';

export default function RCCustomerListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [storeSummary, setStoreSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page, limit };
    if (storeFilter !== 'all') params.store_id = storeFilter;
    if (search) params.search = search;
    api.get('/crm/rc-customers', { params })
      .then(r => { setItems(r.data.customers); setTotal(r.data.total); setStoreSummary(r.data.store_summary || []); })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, [page, storeFilter, search]);

  const totalPages = Math.ceil(total / limit);
  const isHO = ['ADMIN', 'HO_STAFF', 'DIRECTOR'].includes(user?.role);

  return (
    <div data-testid="rc-customer-list-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">RC Customers</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{total} recurring customers{!isHO && user?.store_id ? ' at your store' : ' across all stores'}</p>
        </div>
      </div>

      {/* Store-wise summary cards (HO view only) */}
      {isHO && storeSummary.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {storeSummary.sort((a, b) => b.rc_count - a.rc_count).map(s => (
            <Card key={s.store_id} className={`border-slate-200 shadow-sm rounded-sm cursor-pointer transition-colors ${storeFilter === String(s.store_id) ? 'border-sky-400 bg-sky-50/30' : 'hover:border-slate-300'}`}
              onClick={() => setStoreFilter(storeFilter === String(s.store_id) ? 'all' : String(s.store_id))}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-[11px] font-body text-slate-600 truncate">{s.store_name}</span>
                </div>
                <p className="text-xl font-heading font-bold text-slate-900 mt-1 tabular-nums">{s.rc_count}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input data-testid="rc-search" placeholder="Search by name or mobile..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 font-body text-sm rounded-sm" />
            </div>
            {isHO && (
              <Select value={storeFilter} onValueChange={v => { setStoreFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[200px] font-body text-sm rounded-sm" data-testid="rc-store-filter"><SelectValue placeholder="All Stores" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-340px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Customer', 'Mobile', 'Type', 'Store', 'Active Meds', 'Overdue', 'Total Spent', 'Assigned Staff', 'Adherence', 'Tags', ''].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Active Meds', 'Overdue', 'Total Spent'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center py-16">
                  <UserCheck className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">{loading ? 'Loading...' : 'No RC customers found'}</p>
                </TableCell></TableRow>
              ) : items.map(c => (
                <TableRow key={c.id} className="hover:bg-slate-50/50" data-testid={`rc-row-${c.id}`}>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => navigate(`/crm/customer/${c.id}`)}>{c.customer_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{c.mobile_number}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${c.customer_type === 'chronic' ? 'bg-violet-100 text-violet-700' : 'bg-rose-100 text-rose-700'}`}>{c.customer_type}</Badge></TableCell>
                  <TableCell className="text-[12px] text-slate-500">{c.store_name}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">
                    {c.active_medicines > 0 ? <span className="flex items-center justify-end gap-1"><Pill className="w-3 h-3 text-sky-500" />{c.active_medicines}</span> : <span className="text-slate-300">0</span>}
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">
                    {c.overdue_count > 0 ? <span className="text-red-600 font-medium flex items-center justify-end gap-1"><AlertTriangle className="w-3 h-3" />{c.overdue_count}</span> : <span className="text-emerald-600">0</span>}
                  </TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium">{c.total_spent > 0 ? `INR ${c.total_spent.toLocaleString('en-IN')}` : '-'}</TableCell>
                  <TableCell className="text-[11px] text-slate-500">{c.assigned_staff || <span className="text-slate-300">-</span>}</TableCell>
                  <TableCell>
                    <Badge className={`text-[9px] rounded-sm ${c.adherence === 'high' ? 'bg-emerald-50 text-emerald-700' : c.adherence === 'medium' ? 'bg-amber-50 text-amber-700' : c.adherence === 'low' ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-400'}`}>{c.adherence}</Badge>
                  </TableCell>
                  <TableCell className="flex gap-1 flex-wrap">{c.chronic_tags?.map(t => <Badge key={t} className="text-[8px] rounded-sm bg-violet-50 text-violet-600">{t.replace('_',' ')}</Badge>)}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigate(`/crm/customer/${c.id}`)}><ArrowRight className="w-3.5 h-3.5 text-slate-400" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} | {total.toLocaleString()} RC customers</p>
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
