import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Upload, Search, ChevronLeft, ChevronRight, Package, Download } from 'lucide-react';
import { downloadExcel } from '../lib/api';

export default function ProductMasterPage() {
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const limit = 50;

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (search) params.search = search;
      if (category) params.category = category;
      const res = await api.get('/products', { params });
      setProducts(res.data.products);
      setTotal(res.data.total);
    } catch { toast.error('Failed to load products'); }
    finally { setLoading(false); }
  }, [page, search, category]);

  useEffect(() => {
    api.get('/products/categories').then(r => setCategories(r.data.categories)).catch(() => {});
  }, []);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post('/products/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Upload: ${res.data.success}/${res.data.total} records processed`);
      if (res.data.failed > 0) toast.warning(`${res.data.failed} records failed`);
      const matched = res.data.columns_matched || {};
      const unmatched = res.data.columns_unmatched || [];
      if (Object.keys(matched).length > 0) {
        const mappedList = Object.entries(matched).map(([k, v]) => `${k} → ${v}`).join(', ');
        toast.info(`Columns mapped: ${mappedList}`, { duration: 8000 });
      }
      if (unmatched.length > 0) {
        toast.warning(`Unmapped columns (ignored): ${unmatched.slice(0, 10).join(', ')}`, { duration: 8000 });
      }
      setUploadOpen(false);
      loadProducts();
      api.get('/products/categories').then(r => setCategories(r.data.categories)).catch(() => {});
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div data-testid="product-master-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Product Master</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{total.toLocaleString()} products</p>
        </div>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogTrigger asChild>
            <Button data-testid="upload-products-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs">
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload Excel
            </Button>
          </DialogTrigger>
          <Button variant="outline" className="rounded-sm font-body text-xs ml-2" data-testid="export-products-btn"
            onClick={() => downloadExcel('/export/products', 'products.xlsx').catch(() => toast.error('Export failed'))}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
          <DialogContent className="rounded-sm">
            <DialogHeader><DialogTitle className="font-heading">Upload Product Master</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-500 font-body">Required columns: Product ID, Product Name. Other standard columns mapped automatically.</p>
            <div className="border-2 border-dashed border-slate-200 rounded-sm p-8 text-center hover:border-sky-300 transition-colors">
              <input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={uploading} className="hidden" id="product-upload" data-testid="product-file-input" />
              <label htmlFor="product-upload" className="cursor-pointer">
                <Upload className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500 font-body">{uploading ? 'Processing...' : 'Click to select Excel file'}</p>
                <p className="text-[11px] text-slate-400 mt-1">.xlsx or .xls</p>
              </label>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input data-testid="product-search-input" placeholder="Search products..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 font-body text-sm rounded-sm" />
            </div>
            <Select value={category || 'all'} onValueChange={v => { setCategory(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger data-testid="category-filter" className="w-[180px] font-body text-sm rounded-sm">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-300px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Product ID', 'Product Name', 'Category', 'Sub Category', 'Primary Supplier', 'Secondary Supplier', 'Least Price', 'Most Qty', 'MRP', 'PTR', 'L.Cost'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['MRP', 'PTR', 'L.Cost'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? [...Array(8)].map((_, i) => (
                <TableRow key={i}>{[...Array(11)].map((_, j) => <TableCell key={j}><div className="h-4 bg-slate-50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : products.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center py-16">
                  <Package className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No products found</p>
                </TableCell></TableRow>
              ) : products.map(p => (
                <TableRow key={p.id} className="hover:bg-slate-50/50 transition-colors" data-testid={`product-row-${p.product_id}`}>
                  <TableCell className="font-mono text-[11px] text-slate-500 py-2.5">{p.product_id}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{p.product_name}</TableCell>
                  <TableCell>{p.category && <Badge variant="secondary" className="text-[10px] rounded-sm font-body">{p.category}</Badge>}</TableCell>
                  <TableCell className="text-[11px] font-body text-slate-500">{p.sub_category || '-'}</TableCell>
                  <TableCell className="text-[11px] font-body text-slate-600">{p.primary_supplier || '-'}</TableCell>
                  <TableCell className="text-[11px] font-body text-slate-500">{p.secondary_supplier || '-'}</TableCell>
                  <TableCell className="text-[11px] font-body text-slate-500">{p.least_price_supplier || '-'}</TableCell>
                  <TableCell className="text-[11px] font-body text-slate-500">{p.most_qty_supplier || '-'}</TableCell>
                  <TableCell className="text-right font-body text-[12px] tabular-nums">{(p.mrp || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-body text-[12px] tabular-nums">{(p.ptr || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-body text-[12px] tabular-nums">{(p.landing_cost || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} &middot; {total.toLocaleString()} total</p>
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
