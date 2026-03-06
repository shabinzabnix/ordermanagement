import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { toast } from 'sonner';
import { Upload, Search, Warehouse, Download } from 'lucide-react';
import { downloadExcel } from '../lib/api';

export default function HOStockUploadPage() {
  const [stocks, setStocks] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadStock = async () => {
    setLoading(true);
    try {
      const params = { page: 1, limit: 100 };
      if (search) params.search = search;
      const res = await api.get('/stock/ho', { params });
      setStocks(res.data.stocks);
      setTotal(res.data.total);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { loadStock(); }, [search]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post('/stock/ho/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`HO Stock: ${res.data.success}/${res.data.total} records processed`);
      if (res.data.failed > 0) toast.warning(`${res.data.failed} records failed`);
      loadStock();
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  return (
    <div data-testid="ho-stock-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Head Office Stock</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{total.toLocaleString()} batch records</p>
        </div>
        <div>
          <input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={uploading} className="hidden" id="ho-upload" data-testid="ho-file-input" />
          <label htmlFor="ho-upload">
            <Button asChild className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" data-testid="upload-ho-btn">
              <span><Upload className="w-3.5 h-3.5 mr-1.5" />{uploading ? 'Processing...' : 'Upload Stock Excel'}</span>
            </Button>
          </label>
          <Button variant="outline" className="rounded-sm font-body text-xs ml-2" data-testid="export-ho-btn"
            onClick={() => downloadExcel('/export/ho-stock', 'ho_stock.xlsx').catch(() => toast.error('Export failed'))}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input data-testid="ho-search" placeholder="Search by product name or ID..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-300px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Product ID', 'Product Name', 'Batch', 'MRP', 'Closing Stock', 'L.Cost Value'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['MRP','Closing Stock','L.Cost Value'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {stocks.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-16">
                  <Warehouse className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No HO stock data. Upload an Excel file to begin.</p>
                </TableCell></TableRow>
              ) : stocks.map(s => (
                <TableRow key={s.id} className="hover:bg-slate-50/50">
                  <TableCell className="font-mono text-[11px] text-slate-500">{s.product_id}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.product_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{s.batch}</TableCell>
                  <TableCell className="text-right font-body text-[12px] tabular-nums">{(s.mrp || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-body text-[12px] tabular-nums font-medium">{(s.closing_stock || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-body text-[12px] tabular-nums">{(s.landing_cost_value || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
