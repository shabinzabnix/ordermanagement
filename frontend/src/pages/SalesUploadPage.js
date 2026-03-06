import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Upload, FileSpreadsheet, CheckCircle, Clock, AlertCircle } from 'lucide-react';

export default function SalesUploadPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [medDialog, setMedDialog] = useState(null);
  const [days, setDays] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);
  useEffect(() => {
    if (user?.role === 'STORE_STAFF' && user?.store_id) setSelectedStore(String(user.store_id));
  }, [user]);

  const loadRecords = () => {
    if (!selectedStore) return;
    const params = { store_id: selectedStore, page: 1, limit: 100, pending_only: pendingOnly };
    api.get('/crm/sales', { params }).then(r => { setRecords(r.data.records); setTotal(r.data.total); }).catch(() => {});
  };
  useEffect(() => { loadRecords(); }, [selectedStore, pendingOnly]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedStore) { toast.error('Select a store first'); return; }
    setUploading(true); setUploadResult(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await api.post(`/crm/sales-upload?store_id=${selectedStore}`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 });
      setUploadResult(res.data);
      toast.success(`Imported: ${res.data.success}/${res.data.total} records, ${res.data.new_customers} new customers`);
      loadRecords();
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleUpdateMedication = async () => {
    if (!medDialog || !days) return;
    setSaving(true);
    try {
      const res = await api.put(`/crm/sales/${medDialog.id}/medication`, { days_of_medication: parseInt(days) });
      toast.success(`Due date set: ${new Date(res.data.next_due_date).toLocaleDateString()}`);
      setMedDialog(null); setDays(''); loadRecords();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div data-testid="sales-upload-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Sales Report Upload</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Import daily sales data and track medication</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border-slate-200 shadow-sm rounded-sm lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-heading font-semibold flex items-center gap-2"><Upload className="w-4 h-4 text-sky-500" /> Upload Sales Report</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Select value={selectedStore} onValueChange={setSelectedStore}>
                <SelectTrigger className="w-[220px] font-body text-sm rounded-sm" data-testid="sales-store-select"><SelectValue placeholder="Select Store" /></SelectTrigger>
                <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
              </Select>
              <div>
                <input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={uploading || !selectedStore} className="hidden" id="sales-upload" data-testid="sales-file-input" />
                <label htmlFor="sales-upload">
                  <Button asChild className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={!selectedStore}>
                    <span><Upload className="w-3.5 h-3.5 mr-1.5" />{uploading ? 'Importing...' : 'Upload Excel'}</span>
                  </Button>
                </label>
              </div>
            </div>
            <p className="text-[11px] font-body text-slate-400">Required columns: Patient Name, Mobile Number, Product Name. Optional: Date of Invoice, Entry Number, Product ID, Total Amount</p>
          </CardContent>
        </Card>

        {uploadResult && (
          <Card className="border-emerald-200 bg-emerald-50/30 shadow-sm rounded-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-heading font-semibold text-emerald-700 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Upload Result</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-[12px] font-body">
              <p>Total Rows: <span className="font-medium">{uploadResult.total}</span></p>
              <p>Imported: <span className="font-medium text-emerald-700">{uploadResult.success}</span></p>
              <p>Failed: <span className="font-medium text-red-600">{uploadResult.failed}</span></p>
              <p>New Customers: <span className="font-medium text-sky-600">{uploadResult.new_customers}</span></p>
              <p>Updated: <span className="font-medium">{uploadResult.updated_customers}</span></p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex items-center justify-between">
          <p className="text-sm font-body text-slate-600">{total} sales records {pendingOnly ? '(pending medication update)' : ''}</p>
          <div className="flex gap-2">
            <Button variant={pendingOnly ? 'default' : 'outline'} size="sm" className={`rounded-sm font-body text-xs ${pendingOnly ? 'bg-amber-500 hover:bg-amber-600' : ''}`}
              onClick={() => setPendingOnly(true)} data-testid="filter-pending"><Clock className="w-3 h-3 mr-1" /> Pending</Button>
            <Button variant={!pendingOnly ? 'default' : 'outline'} size="sm" className={`rounded-sm font-body text-xs ${!pendingOnly ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
              onClick={() => setPendingOnly(false)} data-testid="filter-all">All</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-420px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Invoice Date', 'Patient', 'Mobile', 'Product', 'Amount', 'Days', 'Due Date', 'Action'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Amount'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-16"><FileSpreadsheet className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">{selectedStore ? 'No records' : 'Select a store'}</p></TableCell></TableRow>
              ) : records.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50/50" data-testid={`sales-row-${r.id}`}>
                  <TableCell className="text-[11px] text-slate-500">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{r.patient_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{r.mobile_number}</TableCell>
                  <TableCell className="font-body text-[13px] text-slate-700">{r.product_name}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{(r.total_amount || 0).toFixed(2)}</TableCell>
                  <TableCell>
                    {r.medication_updated ? (
                      <Badge className="text-[10px] rounded-sm bg-emerald-50 text-emerald-700">{r.days_of_medication}d</Badge>
                    ) : (
                      <Badge className="text-[10px] rounded-sm bg-amber-50 text-amber-700">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-[11px] text-slate-500">{r.next_due_date ? new Date(r.next_due_date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>
                    {!r.medication_updated && (
                      <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] font-body"
                        onClick={() => { setMedDialog(r); setDays(''); }} data-testid={`set-days-${r.id}`}>
                        <Clock className="w-3 h-3 mr-1" /> Set Days
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!medDialog} onOpenChange={v => { if (!v) setMedDialog(null); }}>
        <DialogContent className="rounded-sm max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Set Medication Duration</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-body text-slate-600"><span className="font-medium">{medDialog?.patient_name}</span> - {medDialog?.product_name}</p>
            <div className="space-y-1.5"><Label className="font-body text-xs">Days of Medication *</Label>
              <Input data-testid="medication-days-input" type="number" value={days} onChange={e => setDays(e.target.value)} placeholder="e.g. 30" className="rounded-sm" />
              <div className="flex gap-2 mt-2">
                {[10, 15, 30, 60, 90].map(d => (
                  <Button key={d} variant="outline" size="sm" className="rounded-sm text-[10px] font-body h-6 px-2" onClick={() => setDays(String(d))}>{d}d</Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving || !days}
              onClick={handleUpdateMedication} data-testid="save-medication-days">{saving ? 'Saving...' : 'Set Duration'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
