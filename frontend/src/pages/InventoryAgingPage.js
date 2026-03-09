import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { downloadExcel } from '../lib/api';
import { toast } from 'sonner';
import { Clock, Search, Download, AlertTriangle, TrendingDown, ChevronLeft, ChevronRight } from 'lucide-react';

export default function InventoryAgingPage() {
  const [data, setData] = useState(null);
  const [locations, setLocations] = useState([]);
  const [locFilter, setLocFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [bucketFilter, setBucketFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 100;
  const timerRef = useRef(null);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 500);
  };

  useEffect(() => {
    setLoading(true);
    const params = { page, limit };
    if (locFilter !== 'all') params.location = locFilter;
    if (statusFilter !== 'all') params.status = statusFilter;
    if (bucketFilter !== 'all') params.bucket = bucketFilter;
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/aging/report', { params }).then(r => {
      setData(r.data);
      if (r.data.locations) setLocations(r.data.locations);
    }).catch(() => toast.error('Failed')).finally(() => setLoading(false));
  }, [page, locFilter, statusFilter, bucketFilter, debouncedSearch]);

  const totalPages = Math.ceil((data?.total || 0) / limit);
  const s = data?.summary || {};

  const statusBadge = (st) => st === 'dead' ? 'bg-red-100 text-red-700' : st === 'slow' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700';

  return (
    <div data-testid="aging-report-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Inventory Aging Report</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{data?.total || 0} batches with stock</p>
        </div>
        <Button variant="outline" className="rounded-sm font-body text-xs" onClick={() => downloadExcel('/export/aging', 'aging_report.xlsx').catch(() => toast.error('Export failed'))}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {[
          { l: '0-30 Days', v: s['0-30'] || 0, c: 'border-t-emerald-400' },
          { l: '30-60 Days', v: s['30-60'] || 0, c: 'border-t-amber-400' },
          { l: '60-90 Days', v: s['60-90'] || 0, c: 'border-t-orange-400' },
          { l: '90+ Days', v: s['90+'] || 0, c: 'border-t-red-400' },
          { l: 'Dead Stock', v: `${data?.dead_count || 0} (INR ${(data?.dead_value || 0).toLocaleString('en-IN')})`, c: 'border-t-red-600' },
          { l: 'Slow Moving', v: `${data?.slow_count || 0} (INR ${(data?.slow_value || 0).toLocaleString('en-IN')})`, c: 'border-t-orange-500' },
        ].map(k => (
          <Card key={k.l} className={`border-slate-200 shadow-sm rounded-sm border-t-4 ${k.c}`}>
            <CardContent className="p-2.5"><p className="text-[9px] font-body text-slate-400 uppercase">{k.l}</p><p className="text-[14px] font-heading font-bold text-slate-900 tabular-nums">{k.v}</p></CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="flex gap-3 flex-wrap items-end">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Search product or ID..." value={search} onChange={e => handleSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" />
            </div>
            <div className="space-y-0.5">
              <span className="text-[9px] font-body text-slate-400 uppercase">Location</span>
              <Select value={locFilter} onValueChange={v => { setLocFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[160px] font-body text-sm rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Locations</SelectItem>{locations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <span className="text-[9px] font-body text-slate-400 uppercase">Status</span>
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[130px] font-body text-sm rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="dead">Dead Stock</SelectItem><SelectItem value="slow">Slow Moving</SelectItem><SelectItem value="active">Active</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <span className="text-[9px] font-body text-slate-400 uppercase">Age Bucket</span>
              <Select value={bucketFilter} onValueChange={v => { setBucketFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[120px] font-body text-sm rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="0-30">0-30d</SelectItem><SelectItem value="30-60">30-60d</SelectItem><SelectItem value="60-90">60-90d</SelectItem><SelectItem value="90+">90+d</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-380px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Location', 'Product', 'ID', 'Batch', 'Stock', 'MRP', 'Stock Date', 'Age (Days)', 'Expiry', '90d Sales', 'Value', 'Status'].map(h => (
                  <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Stock', 'MRP', 'Age (Days)', '90d Sales', 'Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? [...Array(8)].map((_, i) => <TableRow key={i}>{[...Array(12)].map((_, j) => <TableCell key={j}><div className="h-4 bg-slate-50 rounded animate-pulse" /></TableCell>)}</TableRow>) :
               !data?.items?.length ? (
                <TableRow><TableCell colSpan={12} className="text-center py-16"><Clock className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No aging data</p></TableCell></TableRow>
              ) : data.items.map((i, idx) => (
                <TableRow key={idx} className={`hover:bg-slate-50/50 ${i.status === 'dead' ? 'bg-red-50/20' : i.status === 'slow' ? 'bg-orange-50/20' : ''}`}>
                  <TableCell className="text-[11px] text-slate-500">{i.location}</TableCell>
                  <TableCell className="font-body text-[12px] font-medium text-slate-800 max-w-[180px] truncate">{i.product_name}</TableCell>
                  <TableCell className="font-mono text-[10px] text-slate-400">{i.product_id || '-'}</TableCell>
                  <TableCell className="font-mono text-[10px] text-slate-500">{i.batch}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{i.stock}</TableCell>
                  <TableCell className="text-right text-[11px] tabular-nums">{(i.mrp || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-[11px] text-slate-500">{i.stock_date ? new Date(i.stock_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-right"><span className={`text-[12px] tabular-nums font-medium ${i.days > 90 ? 'text-red-600' : i.days > 60 ? 'text-orange-600' : i.days > 30 ? 'text-amber-600' : 'text-slate-500'}`}>{i.days}d</span></TableCell>
                  <TableCell className="text-[11px] text-slate-500">{i.expiry_date ? new Date(i.expiry_date).toLocaleDateString() : <span className="text-slate-300">-</span>}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{i.sales_90d > 0 ? <span className="text-sky-700 font-medium">{i.sales_90d}</span> : <span className="text-slate-300">0</span>}</TableCell>
                  <TableCell className="text-right text-[11px] tabular-nums">INR {(i.value || 0).toLocaleString('en-IN', {maximumFractionDigits: 0})}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${statusBadge(i.status)}`}>{i.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} | {data?.total?.toLocaleString()} items</p>
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
