import { useState, useEffect } from 'react';
import api from '../lib/api';
import { downloadExcel } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Clock, Download, AlertTriangle, TrendingDown } from 'lucide-react';

export default function InventoryAgingPage() {
  const [data, setData] = useState({ items: [], summary: {}, locations: [], dead_count: 0, slow_count: 0, dead_value: 0, slow_value: 0 });
  const [location, setLocation] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (location !== 'all') params.location = location;
    api.get('/aging/report', { params })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load aging data'))
      .finally(() => setLoading(false));
  }, [location]);

  const filtered = statusFilter === 'all' ? data.items : data.items.filter(i => i.status === statusFilter);

  const statusBadge = (s) => {
    if (s === 'dead') return 'bg-red-50 text-red-700 hover:bg-red-50';
    if (s === 'slow') return 'bg-amber-50 text-amber-700 hover:bg-amber-50';
    return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50';
  };

  const bucketBadge = (b) => {
    if (b === '90+') return 'bg-red-50 text-red-700';
    if (b === '60-90') return 'bg-orange-50 text-orange-700';
    if (b === '30-60') return 'bg-amber-50 text-amber-700';
    return 'bg-emerald-50 text-emerald-700';
  };

  return (
    <div data-testid="aging-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Inventory Aging Report</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Track stock age and identify dead/slow moving inventory</p>
        </div>
        <Button variant="outline" className="rounded-sm font-body text-xs" data-testid="export-aging-btn"
          onClick={() => downloadExcel('/export/aging', 'inventory_aging.xlsx').catch(() => toast.error('Export failed'))}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '0-30 Days', value: data.summary?.['0-30'] || 0, color: 'border-t-emerald-500' },
          { label: '30-60 Days', value: data.summary?.['30-60'] || 0, color: 'border-t-amber-500' },
          { label: '60-90 Days', value: data.summary?.['60-90'] || 0, color: 'border-t-orange-500' },
          { label: '90+ Days', value: data.summary?.['90+'] || 0, color: 'border-t-red-500' },
        ].map(b => (
          <Card key={b.label} className={`border-slate-200 shadow-sm rounded-sm border-t-4 ${b.color}`}>
            <CardContent className="p-4">
              <p className="text-[11px] font-body text-slate-400 uppercase tracking-wider">{b.label}</p>
              <p className="text-xl font-heading font-bold text-slate-900 mt-1 tabular-nums">{b.value} items</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-slate-200 shadow-sm rounded-sm border-l-4 border-l-red-500">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-red-50 rounded-sm"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
            <div>
              <p className="text-[11px] font-body text-slate-400 uppercase tracking-wider">Dead Stock</p>
              <p className="text-lg font-heading font-bold text-slate-900">{data.dead_count} items | INR {data.dead_value?.toLocaleString('en-IN')}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm rounded-sm border-l-4 border-l-amber-500">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-amber-50 rounded-sm"><TrendingDown className="w-5 h-5 text-amber-600" /></div>
            <div>
              <p className="text-[11px] font-body text-slate-400 uppercase tracking-wider">Slow Moving</p>
              <p className="text-lg font-heading font-bold text-slate-900">{data.slow_count} items | INR {data.slow_value?.toLocaleString('en-IN')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="flex gap-3 flex-wrap">
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger className="w-[200px] font-body text-sm rounded-sm" data-testid="aging-location-filter"><SelectValue placeholder="All Locations" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {data.locations?.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-1.5">
              {['all', 'dead', 'slow', 'active'].map(s => (
                <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm"
                  className={`rounded-sm font-body text-xs capitalize ${statusFilter === s ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
                  onClick={() => setStatusFilter(s)} data-testid={`aging-filter-${s}`}>{s === 'all' ? 'All' : s}</Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-480px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Location', 'Product ID', 'Product', 'Batch', 'Stock', 'MRP', 'Days', 'Bucket', 'Value', 'Status'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Stock','MRP','Days','Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-16">
                  <Clock className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No aging data available</p>
                </TableCell></TableRow>
              ) : filtered.slice(0, 200).map((i, idx) => (
                <TableRow key={idx} className="hover:bg-slate-50/50">
                  <TableCell className="text-[12px] font-body text-slate-600">{i.location}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{i.product_id}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{i.product_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{i.batch}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{i.stock?.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{(i.mrp || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium">{i.days}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${bucketBadge(i.bucket)}`}>{i.bucket}</Badge></TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{(i.value || 0).toFixed(2)}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${statusBadge(i.status)}`}>{i.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
