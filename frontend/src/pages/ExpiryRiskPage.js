import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { downloadExcel } from '../lib/api';
import { toast } from 'sonner';
import { ShieldAlert, Download } from 'lucide-react';

export default function ExpiryRiskPage() {
  const [data, setData] = useState({ items: [], summary: {} });
  const [riskFilter, setRiskFilter] = useState('all');
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (riskFilter !== 'all') params.risk_level = riskFilter;
    if (storeFilter !== 'all') params.store_id = storeFilter;
    api.get('/intel/expiry-risk', { params }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [riskFilter, storeFilter]);

  const riskBadge = (r) => r === '30d' ? 'bg-red-100 text-red-700' : r === '60d' ? 'bg-orange-50 text-orange-700' : 'bg-amber-50 text-amber-700';
  const s = data.summary || {};

  if (loading) return <div className="space-y-4"><Skeleton className="h-24 rounded-sm" /><Skeleton className="h-96 rounded-sm" /></div>;

  return (
    <div data-testid="expiry-risk-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Expiry Risk Monitor</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Track batches approaching expiry dates</p>
        </div>
        <Button variant="outline" className="rounded-sm font-body text-xs" data-testid="export-expiry-btn"
          onClick={() => downloadExcel('/export/aging', 'expiry_risk.xlsx').catch(() => toast.error('Export failed'))}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Expiring 30 Days', value: s['30d'] || 0, color: 'border-t-red-500' },
          { label: 'Expiring 60 Days', value: s['60d'] || 0, color: 'border-t-orange-500' },
          { label: 'Expiring 90 Days', value: s['90d'] || 0, color: 'border-t-amber-500' },
          { label: 'At-Risk Value', value: `INR ${(s.total_value || 0).toLocaleString('en-IN')}`, color: 'border-t-slate-400' },
        ].map(b => (
          <Card key={b.label} className={`border-slate-200 shadow-sm rounded-sm border-t-4 ${b.color}`}>
            <CardContent className="p-4">
              <p className="text-[10px] font-body text-slate-400 uppercase tracking-wider">{b.label}</p>
              <p className="text-xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{b.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3">
          <div className="flex gap-1.5">
            {['all', '30d', '60d', '90d'].map(r => (
              <Button key={r} variant={riskFilter === r ? 'default' : 'outline'} size="sm"
                className={`rounded-sm font-body text-xs ${riskFilter === r ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
                onClick={() => setRiskFilter(r)} data-testid={`risk-filter-${r}`}>{r === 'all' ? 'All' : r}</Button>
            ))}
          </div>
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-[180px] font-body text-sm rounded-sm"><SelectValue placeholder="All Stores" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-380px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Location', 'Product', 'Batch', 'Stock', 'MRP', 'Expiry Date', 'Days Left', 'Value', 'Risk'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Stock','MRP','Days Left','Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-16"><ShieldAlert className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No expiry risks detected. Add expiry dates in stock uploads.</p></TableCell></TableRow>
              ) : data.items.map((i, idx) => (
                <TableRow key={idx} className="hover:bg-slate-50/50">
                  <TableCell className="text-[12px] text-slate-600">{i.location}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{i.product_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{i.batch}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{i.stock?.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{(i.mrp || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-[11px] text-slate-600 font-medium">{i.expiry_date ? new Date(i.expiry_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-right"><span className={`text-[12px] tabular-nums font-medium ${i.days_to_expiry <= 30 ? 'text-red-600' : i.days_to_expiry <= 60 ? 'text-orange-600' : 'text-amber-600'}`}>{i.days_to_expiry}d</span></TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{(i.value || 0).toFixed(2)}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${riskBadge(i.risk_level)}`}>{i.risk_level}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
