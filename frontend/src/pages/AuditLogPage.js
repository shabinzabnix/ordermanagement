import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState('all');
  const limit = 50;

  useEffect(() => {
    const params = { page, limit };
    if (entityFilter !== 'all') params.entity_type = entityFilter;
    api.get('/audit-logs', { params }).then(r => { setLogs(r.data.logs); setTotal(r.data.total); }).catch(() => {});
  }, [page, entityFilter]);

  const totalPages = Math.ceil(total / limit);

  const typeColor = (t) => {
    const map = { product: 'bg-sky-50 text-sky-700', store: 'bg-emerald-50 text-emerald-700',
      transfer: 'bg-amber-50 text-amber-700', purchase: 'bg-rose-50 text-rose-700',
      customer: 'bg-violet-50 text-violet-700', ho_stock: 'bg-blue-50 text-blue-700',
      store_stock: 'bg-teal-50 text-teal-700', consolidated: 'bg-indigo-50 text-indigo-700' };
    return map[t] || 'bg-slate-50 text-slate-700';
  };

  return (
    <div data-testid="audit-log-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Audit Log</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{total} actions tracked</p>
        </div>
        <Select value={entityFilter} onValueChange={v => { setEntityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px] font-body text-sm rounded-sm" data-testid="audit-type-filter"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {['product', 'store', 'transfer', 'purchase', 'customer', 'ho_stock', 'store_stock', 'consolidated'].map(t => (
              <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-240px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Time', 'User', 'Action', 'Type', 'Entity ID'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-16">
                  <ClipboardList className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No audit logs recorded yet</p>
                </TableCell></TableRow>
              ) : logs.map(l => (
                <TableRow key={l.id} className="hover:bg-slate-50/50" data-testid={`audit-row-${l.id}`}>
                  <TableCell className="text-[11px] font-body text-slate-400 whitespace-nowrap">
                    {l.created_at ? new Date(l.created_at).toLocaleString() : '-'}
                  </TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{l.user_name || '-'}</TableCell>
                  <TableCell className="font-body text-[12px] text-slate-600 max-w-[300px] truncate">{l.action}</TableCell>
                  <TableCell>{l.entity_type && <Badge className={`text-[10px] rounded-sm ${typeColor(l.entity_type)}`}>{l.entity_type}</Badge>}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{l.entity_id || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages}</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="h-7 w-7 p-0 rounded-sm">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages} className="h-7 w-7 p-0 rounded-sm">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
