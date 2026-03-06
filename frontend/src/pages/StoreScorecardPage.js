import { useState, useEffect } from 'react';
import api from '../lib/api';
import { downloadExcel } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { toast } from 'sonner';
import { Trophy, Download, TrendingUp, AlertTriangle, ArrowLeftRight, Target } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

export default function StoreScorecardPage() {
  const [data, setData] = useState({ stores: [], network_avg: {} });
  const [loading, setLoading] = useState(true);
  const [selectedStore, setSelectedStore] = useState(null);

  useEffect(() => {
    api.get('/scorecard')
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load scorecard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6" data-testid="scorecard-loading">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-sm" />)}
        </div>
        <Skeleton className="h-96 rounded-sm" />
      </div>
    );
  }

  const avg = data.network_avg || {};
  const stores = data.stores || [];
  const detail = selectedStore ? stores.find(s => s.store_id === selectedStore) : null;

  const rankBadge = (rank) => {
    if (rank === 1) return 'bg-amber-400 text-amber-950 hover:bg-amber-400';
    if (rank === 2) return 'bg-slate-300 text-slate-800 hover:bg-slate-300';
    if (rank === 3) return 'bg-orange-300 text-orange-900 hover:bg-orange-300';
    return 'bg-slate-100 text-slate-600 hover:bg-slate-100';
  };

  const scoreColor = (score) => {
    if (score >= 80) return 'text-emerald-600';
    if (score >= 60) return 'text-sky-600';
    if (score >= 40) return 'text-amber-600';
    return 'text-red-600';
  };

  const scoreBg = (score) => {
    if (score >= 80) return 'bg-emerald-50 border-emerald-200';
    if (score >= 60) return 'bg-sky-50 border-sky-200';
    if (score >= 40) return 'bg-amber-50 border-amber-200';
    return 'bg-red-50 border-red-200';
  };

  const radarData = detail ? [
    { metric: 'Turnover', value: Math.min(detail.turnover_ratio * 100, 100), fullMark: 100 },
    { metric: 'Stock Health', value: 100 - detail.dead_stock_pct, fullMark: 100 },
    { metric: 'Compliance', value: detail.transfer_compliance, fullMark: 100 },
    { metric: 'Sales Velocity', value: detail.total_sales > 0 ? Math.min((detail.total_sales / (detail.total_stock || 1)) * 100, 100) : 0, fullMark: 100 },
    { metric: 'Freshness', value: detail.avg_aging_days < 30 ? 90 : detail.avg_aging_days < 60 ? 60 : detail.avg_aging_days < 90 ? 30 : 10, fullMark: 100 },
  ] : [];

  const barData = stores.map(s => ({
    name: s.store_code || s.store_name?.slice(0, 12),
    score: s.score,
    turnover: s.turnover_ratio * 100,
  }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-sm p-2.5 shadow-md">
        <p className="text-[11px] font-heading font-semibold text-slate-700 mb-1">{label}</p>
        {payload.map((p, i) => (
          <p key={i} className="text-[11px] font-body text-slate-500">
            {p.dataKey}: <span className="font-medium text-slate-800">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div data-testid="scorecard-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Store Performance Scorecard</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Ranking stores by inventory efficiency and operational compliance</p>
        </div>
        <Button variant="outline" className="rounded-sm font-body text-xs" data-testid="export-scorecard-btn"
          onClick={() => downloadExcel('/export/scorecard', 'store_scorecard.xlsx').catch(() => toast.error('Export failed'))}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export
        </Button>
      </div>

      {/* Network Averages */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Avg Score', value: avg.avg_score || 0, icon: Target, bg: 'bg-sky-50', fg: 'text-sky-600', fmt: (v) => v.toFixed(1) },
          { label: 'Avg Turnover', value: avg.avg_turnover || 0, icon: TrendingUp, bg: 'bg-emerald-50', fg: 'text-emerald-600', fmt: (v) => v.toFixed(2) },
          { label: 'Avg Dead Stock', value: avg.avg_dead_pct || 0, icon: AlertTriangle, bg: 'bg-red-50', fg: 'text-red-600', fmt: (v) => `${v.toFixed(1)}%` },
          { label: 'Avg Compliance', value: avg.avg_compliance || 0, icon: ArrowLeftRight, bg: 'bg-violet-50', fg: 'text-violet-600', fmt: (v) => `${v.toFixed(1)}%` },
        ].map(kpi => (
          <Card key={kpi.label} className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-body font-medium text-slate-400 uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-xl font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{kpi.fmt(kpi.value)}</p>
                </div>
                <div className={`p-2 rounded-sm ${kpi.bg}`}><kpi.icon className={`w-4 h-4 ${kpi.fg}`} strokeWidth={1.75} /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Score Comparison Chart */}
      {barData.length > 0 && (
        <Card className="border-slate-200 shadow-sm rounded-sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-heading font-semibold">Performance Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#94A3B8' }} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="score" fill="#0EA5E9" radius={[3, 3, 0, 0]} name="Score" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rankings Table */}
        <div className="lg:col-span-2">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-520px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="border-b-2 border-slate-100">
                    {['Rank', 'Store', 'SKUs', 'Stock Value', 'Turnover', 'Dead %', 'Compliance', 'Score'].map(h => (
                      <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['SKUs', 'Stock Value', 'Turnover', 'Dead %', 'Compliance', 'Score'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stores.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-16">
                      <Trophy className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                      <p className="text-sm text-slate-400 font-body">No stores with stock data</p>
                    </TableCell></TableRow>
                  ) : stores.map(s => (
                    <TableRow key={s.store_id}
                      className={`hover:bg-slate-50/50 cursor-pointer transition-colors ${selectedStore === s.store_id ? 'bg-sky-50/50' : ''}`}
                      onClick={() => setSelectedStore(selectedStore === s.store_id ? null : s.store_id)}
                      data-testid={`scorecard-row-${s.store_id}`}>
                      <TableCell>
                        <Badge className={`text-[10px] rounded-sm font-heading font-bold tabular-nums w-7 justify-center ${rankBadge(s.rank)}`}>
                          {s.rank}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-body text-[13px] font-medium text-slate-800">{s.store_name}</p>
                          <p className="font-mono text-[10px] text-slate-400">{s.store_code}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{s.sku_count}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">INR {s.stock_value.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums font-medium">{s.turnover_ratio.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <span className={`text-[12px] tabular-nums font-medium ${s.dead_stock_pct > 30 ? 'text-red-600' : s.dead_stock_pct > 15 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {s.dead_stock_pct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`text-[12px] tabular-nums font-medium ${s.transfer_compliance >= 80 ? 'text-emerald-600' : s.transfer_compliance >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                          {s.transfer_compliance.toFixed(0)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={`inline-flex items-center justify-center px-2.5 py-1 rounded-sm border text-[13px] font-heading font-bold tabular-nums ${scoreBg(s.score)} ${scoreColor(s.score)}`}>
                          {s.score.toFixed(1)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>

        {/* Store Detail / Radar Chart */}
        <div>
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-heading font-semibold">
                {detail ? detail.store_name : 'Select a store'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {detail ? (
                <div className="space-y-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                      <PolarGrid stroke="#E2E8F0" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fontFamily: 'Public Sans', fill: '#64748B' }} />
                      <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                      <Radar name={detail.store_name} dataKey="value" stroke="#0EA5E9" fill="#0EA5E9" fillOpacity={0.2} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                  <div className="space-y-2">
                    {[
                      { label: 'Total Stock', value: `${detail.total_stock.toLocaleString()} units` },
                      { label: 'Total Sales', value: `${detail.total_sales.toLocaleString()} units` },
                      { label: 'Dead Items', value: `${detail.dead_items} items (${detail.dead_stock_pct}%)` },
                      { label: 'Slow Moving', value: `${detail.slow_items} items (${detail.slow_moving_pct}%)` },
                      { label: 'Avg Aging', value: `${detail.avg_aging_days} days` },
                      { label: 'Transfers', value: `${detail.transfers_approved}/${detail.transfers_total} approved` },
                      { label: 'Purchase Reqs', value: detail.purchase_requests },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                        <span className="text-[11px] font-body text-slate-500">{item.label}</span>
                        <span className="text-[12px] font-body font-medium text-slate-800 tabular-nums">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-16">
                  <Trophy className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-xs text-slate-400 font-body">Click a store row to view details</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
