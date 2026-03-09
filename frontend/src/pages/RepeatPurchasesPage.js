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
import { RefreshCw, Search, ChevronLeft, ChevronRight, ArrowRight, Pill, CheckCircle } from 'lucide-react';

export default function RepeatPurchasesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [stores, setStores] = useState([]);
  const isStore = ['STORE_STAFF', 'STORE_MANAGER'].includes(user?.role);
  const [storeFilter, setStoreFilter] = useState(isStore && user?.store_id ? String(user.store_id) : 'all');
  const [minCount, setMinCount] = useState('2');
  const [loading, setLoading] = useState(true);
  const limit = 50;

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page, limit, min_count: parseInt(minCount) || 2 };
    if (storeFilter !== 'all') params.store_id = storeFilter;
    if (search) params.search = search;
    api.get('/crm/repeat-purchases', { params })
      .then(r => { setItems(r.data.items); setTotal(r.data.total); })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, [page, storeFilter, search, minCount]);

  const totalPages = Math.ceil(total / limit);
  const typeBadge = { rc: 'bg-rose-100 text-rose-700', chronic: 'bg-violet-100 text-violet-700', high_value: 'bg-amber-100 text-amber-700', walkin: 'bg-slate-100 text-slate-600' };

  return (
    <div data-testid="repeat-purchases-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Repeat Medicine Purchases</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{total} customers buying the same medicine repeatedly</p>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="flex gap-3 flex-wrap items-end">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input data-testid="repeat-search" placeholder="Search customer, mobile or medicine..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 font-body text-sm rounded-sm" />
            </div>
            <Select value={storeFilter} onValueChange={v => { setStoreFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px] font-body text-sm rounded-sm" data-testid="repeat-store-filter"><SelectValue placeholder="All Stores" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="space-y-0.5">
              <span className="text-[9px] font-body text-slate-400 uppercase tracking-wider">Min Purchases</span>
              <Select value={minCount} onValueChange={v => { setMinCount(v); setPage(1); }}>
                <SelectTrigger className="w-[100px] font-body text-sm rounded-sm" data-testid="min-count-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2+</SelectItem>
                  <SelectItem value="3">3+</SelectItem>
                  <SelectItem value="5">5+</SelectItem>
                  <SelectItem value="10">10+</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-320px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Customer', 'Mobile', 'Type', 'Store', 'Medicine', 'Times', 'Total Qty', 'Total Spent', 'First', 'Last', 'Avg Interval', 'Tracked', ''].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Times', 'Total Qty', 'Total Spent', 'Avg Interval'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center py-16">
                  <RefreshCw className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">{loading ? 'Loading...' : 'No repeat purchases found'}</p>
                </TableCell></TableRow>
              ) : items.map((d, i) => (
                <TableRow key={`${d.customer_id}-${d.product_name}-${i}`} className="hover:bg-slate-50/50">
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => navigate(`/crm/customer/${d.customer_id}`)}>{d.customer_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{d.mobile}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${typeBadge[d.customer_type] || 'bg-slate-100 text-slate-600'}`}>{d.customer_type}</Badge></TableCell>
                  <TableCell className="text-[12px] text-slate-500">{d.store_name}</TableCell>
                  <TableCell className="font-body text-[13px] text-slate-700 flex items-center gap-1.5"><Pill className="w-3.5 h-3.5 text-sky-500 shrink-0" />{d.product_name}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums font-bold text-sky-700">{d.purchase_count}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{d.total_qty}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {d.total_spent.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-[11px] text-slate-400">{d.first_purchase ? new Date(d.first_purchase).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-[11px] text-slate-400">{d.last_purchase ? new Date(d.last_purchase).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{d.avg_interval_days > 0 ? `${d.avg_interval_days}d` : '-'}</TableCell>
                  <TableCell>
                    {d.is_tracked ? (
                      <Badge className="text-[9px] rounded-sm bg-emerald-50 text-emerald-700"><CheckCircle className="w-2.5 h-2.5 mr-0.5 inline" />Active</Badge>
                    ) : (
                      <span className="text-[10px] text-slate-300">No</span>
                    )}
                  </TableCell>
                  <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigate(`/crm/customer/${d.customer_id}`)}><ArrowRight className="w-3.5 h-3.5 text-slate-400" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} | {total.toLocaleString()} records</p>
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
