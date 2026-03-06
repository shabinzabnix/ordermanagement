import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { TrendingUp, AlertCircle } from 'lucide-react';

export default function DemandForecastPage() {
  const [data, setData] = useState({ forecasts: [], total: 0 });
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [period, setPeriod] = useState('30');
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = { days: parseInt(period) };
    if (storeFilter !== 'all') params.store_id = storeFilter;
    api.get('/intel/demand-forecast', { params })
      .then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [storeFilter, period]);

  const urgencyBadge = (u) => u === 'critical' ? 'bg-red-100 text-red-700' : u === 'low' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700';

  if (loading) return <div className="space-y-4"><Skeleton className="h-16 rounded-sm" /><Skeleton className="h-96 rounded-sm" /></div>;

  return (
    <div data-testid="demand-forecast-page" className="space-y-5">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Demand Forecast & Reorder Intelligence</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">{data.total} products analyzed | Forecast period: {period} days</p>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-[200px] font-body text-sm rounded-sm"><SelectValue placeholder="All Stores" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Stores</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px] font-body text-sm rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="15">15 Day Forecast</SelectItem><SelectItem value="30">30 Day Forecast</SelectItem><SelectItem value="60">60 Day Forecast</SelectItem></SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Product', 'Store', '30d Sales', '60d Sales', '90d Sales', 'Avg/Day', 'Current Stock', 'Days Left', 'Reorder Qty', 'Urgency'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['30d Sales','60d Sales','90d Sales','Avg/Day','Current Stock','Days Left','Reorder Qty'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.forecasts.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-16"><TrendingUp className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No forecast data. Upload sales data first.</p></TableCell></TableRow>
              ) : data.forecasts.map((f, i) => (
                <TableRow key={i} className="hover:bg-slate-50/50">
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 max-w-[200px] truncate">{f.product_name}</TableCell>
                  <TableCell className="text-[12px] text-slate-500">{f.store_name}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{f.sales_30d}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{f.sales_60d}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{f.sales_90d}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium">{f.avg_daily}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{f.current_stock}</TableCell>
                  <TableCell className="text-right"><span className={`text-[12px] tabular-nums font-medium ${f.days_of_stock < 7 ? 'text-red-600' : f.days_of_stock < 15 ? 'text-amber-600' : 'text-slate-600'}`}>{f.days_of_stock >= 999 ? 'N/A' : f.days_of_stock}</span></TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-bold text-sky-700">{f.reorder_qty}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${urgencyBadge(f.urgency)}`}>{f.urgency}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
