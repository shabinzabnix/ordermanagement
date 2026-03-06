import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { FileUp, Download } from 'lucide-react';
import { Button } from '../components/ui/button';
import { downloadExcel } from '../lib/api';
import { toast } from 'sonner';

export default function UploadHistoryPage() {
  const [uploads, setUploads] = useState([]);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    const params = {};
    if (typeFilter !== 'all') params.upload_type = typeFilter;
    api.get('/uploads', { params }).then(r => setUploads(r.data.uploads)).catch(() => {});
  }, [typeFilter]);

  return (
    <div data-testid="upload-history-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Upload History</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Track all file uploads</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-sm font-body text-xs" data-testid="export-uploads-btn"
            onClick={() => downloadExcel('/export/uploads', 'uploads.xlsx').catch(() => toast.error('Export failed'))}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px] font-body text-sm rounded-sm" data-testid="upload-type-filter">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="product_master">Product Master</SelectItem>
            <SelectItem value="ho_stock">HO Stock</SelectItem>
            <SelectItem value="store_stock">Store Stock</SelectItem>
          </SelectContent>
        </Select>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-slate-100">
                {['File Name', 'Type', 'Total', 'Success', 'Failed', 'Date'].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Total','Success','Failed'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {uploads.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-16">
                  <FileUp className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No upload records</p>
                </TableCell></TableRow>
              ) : uploads.map(u => (
                <TableRow key={u.id} className="hover:bg-slate-50/50" data-testid={`upload-row-${u.id}`}>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800 max-w-[300px] truncate">{u.file_name}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px] rounded-sm font-body">{u.upload_type?.replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{u.total_records}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums text-emerald-600">{u.success_records}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums text-red-600">{u.failed_records || 0}</TableCell>
                  <TableCell className="text-[11px] text-slate-400">{u.created_at ? new Date(u.created_at).toLocaleString() : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
