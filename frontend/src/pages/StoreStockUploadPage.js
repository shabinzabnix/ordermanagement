import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { Upload, Search, Archive, Download } from 'lucide-react';
import { downloadExcel } from '../lib/api';
import { UploadProgress } from '../components/UploadProgress';

export default function StoreStockUploadPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [stocks, setStocks] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ phase: 'idle', percent: 0 });

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);
  // Auto-select store for store_staff
  useEffect(() => {
    if (['STORE_STAFF','STORE_MANAGER'].includes(user?.role) && user?.store_id && !selectedStore) {
      setSelectedStore(String(user.store_id));
    }
  }, [user]);

  useEffect(() => {
    if (!selectedStore) return;
    setLoading(true);
    const params = { page: 1, limit: 100 };
    if (search) params.search = search;
    api.get(`/stock/store/${selectedStore}`, { params })
      .then(r => { setStocks(r.data.stocks); setTotal(r.data.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedStore, search]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedStore) { toast.error('Select a store first'); return; }
    setUploading(true);
    setUploadProgress({ phase: 'uploading', percent: 0 });
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post(`/stock/store/upload?store_id=${selectedStore}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          const pct = Math.round((evt.loaded * 100) / (evt.total || 1));
          setUploadProgress({ phase: 'uploading', percent: pct });
          if (pct >= 100) setUploadProgress({ phase: 'processing', percent: 100 });
        },
      });
      setUploadProgress({ phase: 'done', percent: 100 });
      toast.success(`Store Stock: ${res.data.success}/${res.data.total} records processed`);
      if (res.data.failed > 0) toast.warning(`${res.data.failed} records failed`);
      const params = { page: 1, limit: 100 };
      if (search) params.search = search;
      api.get(`/stock/store/${selectedStore}`, { params }).then(r => { setStocks(r.data.stocks); setTotal(r.data.total); });
      setTimeout(() => setUploadProgress({ phase: 'idle', percent: 0 }), 3000);
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); setUploadProgress({ phase: 'idle', percent: 0 }); }
    finally { setUploading(false); e.target.value = ''; }
  };

  return (
    <div data-testid="store-stock-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Store Stock</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Upload and view store inventory</p>
        </div>
        <div>
          <input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={uploading || !selectedStore} className="hidden" id="store-upload" data-testid="store-file-input" />
          <label htmlFor="store-upload">
            <Button asChild className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={!selectedStore} data-testid="upload-store-btn">
              <span><Upload className="w-3.5 h-3.5 mr-1.5" />{uploading ? 'Processing...' : 'Upload Stock'}</span>
            </Button>
          </label>
          {selectedStore && (
            <Button variant="outline" className="rounded-sm font-body text-xs ml-2" data-testid="export-store-btn"
              onClick={() => downloadExcel(`/export/store-stock/${selectedStore}`, 'store_stock.xlsx').catch(() => toast.error('Export failed'))}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Export
            </Button>
          )}
        </div>
      </div>

      <UploadProgress phase={uploadProgress.phase} percent={uploadProgress.percent} />

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="flex gap-3">
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger data-testid="store-select" className="w-[220px] font-body text-sm rounded-sm">
                <SelectValue placeholder="Select Store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name} ({s.store_code})</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input data-testid="store-stock-search" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-320px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['HO ID', 'Store ID', 'Product', 'Batch', 'Packing', 'Stock (Units)', 'Stock (Strips)', 'Sales', 'MRP'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Packing','Stock (Units)','Stock (Strips)','Sales','MRP'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!selectedStore ? (
                <TableRow><TableCell colSpan={9} className="text-center py-16">
                  <Archive className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">Select a store to view stock</p>
                </TableCell></TableRow>
              ) : stocks.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-16">
                  <Archive className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No stock data for this store</p>
                </TableCell></TableRow>
              ) : stocks.map(s => (
                <TableRow key={s.id} className="hover:bg-slate-50/50">
                  <TableCell className="font-mono text-[11px] text-slate-500">{s.ho_product_id || '-'}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{s.store_product_id || '-'}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.product_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{s.batch}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{s.packing}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{s.closing_stock.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium text-sky-700">{s.closing_stock_strips.toFixed(1)}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{s.sales}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{(s.mrp || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
