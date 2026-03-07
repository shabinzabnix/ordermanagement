import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { downloadExcel } from '../lib/api';
import { toast } from 'sonner';
import { Upload, Search, Download, CheckCircle, ShoppingBag, Truck, ChevronLeft, ChevronRight, Package } from 'lucide-react';

export default function PurchaseUploadPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [period, setPeriod] = useState('30');
  const [loading, setLoading] = useState(false);
  const limit = 100;

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);
  useEffect(() => { if (user?.role === 'STORE_STAFF' && user?.store_id) setSelectedStore(String(user.store_id)); }, [user]);

  useEffect(() => {
    if (!selectedStore) return;
    setLoading(true);
    const params = { store_id: selectedStore, page, limit };
    if (search) params.search = search;
    if (supplier) params.supplier = supplier;
    api.get('/intel/purchase-records', { params }).then(r => { setRecords(r.data.records); setTotal(r.data.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [selectedStore, page, search, supplier]);

  useEffect(() => {
    const params = { days: parseInt(period) };
    if (selectedStore) params.store_id = selectedStore;
    api.get('/intel/purchase-analytics', { params }).then(r => setAnalytics(r.data)).catch(() => {});
  }, [selectedStore, period]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedStore) { toast.error('Select a store first'); return; }
    setUploading(true); setUploadResult(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await api.post(`/intel/purchase-upload?store_id=${selectedStore}`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 });
      setUploadResult(res.data);
      toast.success(`Imported: ${res.data.new_records} new, ${res.data.skipped_duplicate} duplicates skipped`);
      setPage(1); setSearch('');
      // Refresh
      api.get('/intel/purchase-records', { params: { store_id: selectedStore, page: 1, limit } }).then(r => { setRecords(r.data.records); setTotal(r.data.total); });
      const params = { days: parseInt(period) }; if (selectedStore) params.store_id = selectedStore;
      api.get('/intel/purchase-analytics', { params }).then(r => setAnalytics(r.data));
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div data-testid="purchase-upload-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Purchase Report</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Upload & analyze store-wise purchase data</p>
        </div>
        <Button variant="outline" className="rounded-sm font-body text-xs" onClick={() => {
          const params = new URLSearchParams(); if (selectedStore) params.append('store_id', selectedStore);
          downloadExcel(`/intel/export-purchase-records?${params}`, 'purchase_records.xlsx').catch(() => toast.error('Export failed'));
        }} data-testid="export-purchases"><Download className="w-3.5 h-3.5 mr-1.5" /> Export</Button>
      </div>

      {/* Upload + Store Select */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3 flex-wrap items-end">
          <div className="space-y-1">
            <label className="text-[10px] font-body text-slate-400 uppercase tracking-wider">Store</label>
            <Select value={selectedStore} onValueChange={v => { setSelectedStore(v); setPage(1); }}>
              <SelectTrigger className="w-[200px] font-body text-sm rounded-sm"><SelectValue placeholder="Select Store" /></SelectTrigger>
              <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={uploading || !selectedStore} className="hidden" id="purchase-upload-input" />
            <label htmlFor="purchase-upload-input">
              <Button asChild className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={!selectedStore}>
                <span><Upload className="w-3.5 h-3.5 mr-1.5" />{uploading ? 'Importing...' : 'Upload Purchase Excel'}</span>
              </Button>
            </label>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[130px] font-body text-sm rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="7">7 Days</SelectItem><SelectItem value="30">30 Days</SelectItem><SelectItem value="90">90 Days</SelectItem></SelectContent>
          </Select>
          {uploadResult && (
            <Badge className="text-[11px] rounded-sm bg-emerald-50 text-emerald-700"><CheckCircle className="w-3 h-3 mr-1 inline" />
              New: {uploadResult.new_records} | Skipped: {uploadResult.skipped_duplicate} | Failed: {uploadResult.failed}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Analytics KPIs */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { l: 'Purchase Amount', v: `INR ${analytics.total_purchase_amount?.toLocaleString('en-IN')}`, icon: ShoppingBag, bg: 'bg-sky-50', fg: 'text-sky-600' },
            { l: 'Purchase Qty', v: analytics.total_purchase_qty?.toLocaleString(), icon: Package, bg: 'bg-emerald-50', fg: 'text-emerald-600' },
            { l: 'Invoices', v: analytics.total_invoices, icon: Upload, bg: 'bg-amber-50', fg: 'text-amber-600' },
            { l: 'Top Supplier', v: analytics.suppliers?.[0]?.supplier?.slice(0, 20) || '-', icon: Truck, bg: 'bg-violet-50', fg: 'text-violet-600' },
          ].map(k => (
            <Card key={k.l} className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-3">
              <div className="flex items-start justify-between"><div>
                <p className="text-[9px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p>
                <p className="text-lg font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.v}</p>
              </div><div className={`p-2 rounded-sm ${k.bg}`}><k.icon className={`w-4 h-4 ${k.fg}`} strokeWidth={1.75} /></div></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* Supplier + Sales vs Purchase */}
      {analytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Truck className="w-4 h-4 text-slate-400" /> Top Suppliers</CardTitle></CardHeader>
            <div className="overflow-auto max-h-[250px]"><Table><TableBody>
              {analytics.suppliers?.slice(0, 10).map((s, i) => (
                <TableRow key={i} className="hover:bg-slate-50/50">
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.supplier}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums text-emerald-700 font-medium">INR {s.amount.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums text-slate-500">{s.qty} qty</TableCell>
                </TableRow>
              ))}
            </TableBody></Table></div>
          </Card>
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold">Purchase vs Sales (Top Products)</CardTitle></CardHeader>
            <div className="overflow-auto max-h-[250px]"><Table>
              <TableHeader><TableRow className="border-b border-slate-100">
                {['Product', 'Purchased', 'Sold'].map(h => <TableHead key={h} className="text-[9px] uppercase tracking-wider font-bold text-slate-400 font-body py-2">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {analytics.purchase_vs_sales?.slice(0, 10).map((p, i) => (
                  <TableRow key={i} className="hover:bg-slate-50/50">
                    <TableCell className="text-[12px] font-medium text-slate-800 max-w-[180px] truncate">{p.product}</TableCell>
                    <TableCell className="text-[11px] tabular-nums">{p.purchase_qty} qty / INR {p.purchase_amt.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-[11px] tabular-nums">{p.sales_qty} qty / INR {p.sales_amt.toLocaleString('en-IN')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </Card>
        </div>
      )}

      {/* Records Table */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Search product..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 font-body text-sm rounded-sm" /></div>
          <Input placeholder="Filter supplier..." value={supplier} onChange={e => { setSupplier(e.target.value); setPage(1); }} className="w-[180px] font-body text-sm rounded-sm" />
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-500px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Date', 'Entry No', 'Store', 'Supplier', 'Product', 'Product ID', 'Qty', 'Amount'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Qty', 'Amount'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16"><ShoppingBag className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">{selectedStore ? 'No purchase records' : 'Select a store'}</p></TableCell></TableRow>
              ) : records.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50/50">
                  <TableCell className="text-[11px] text-slate-500">{r.purchase_date ? new Date(r.purchase_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{r.entry_number || '-'}</TableCell>
                  <TableCell className="text-[12px] text-slate-500">{r.store_name}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-700">{r.supplier_name}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 max-w-[200px] truncate">{r.product_name}</TableCell>
                  <TableCell className="font-mono text-[10px] text-slate-400">{r.product_id || '-'}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{r.quantity}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {r.total_amount.toLocaleString('en-IN')}</TableCell>
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
