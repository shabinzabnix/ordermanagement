import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';
import { Search, Receipt, User, Pill, Calendar, IndianRupee } from 'lucide-react';

export default function PurchaseHistoryPage() {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!mobile || mobile.length < 10) { toast.error('Enter a valid 10-digit mobile number'); return; }
    setLoading(true);
    try {
      const res = await api.get(`/crm/purchase-history/${mobile}`);
      setData(res.data);
      if (!res.data.customer) toast.warning('No customer found with this mobile number');
    } catch { toast.error('Search failed'); }
    finally { setLoading(false); }
  };

  return (
    <div data-testid="purchase-history-page" className="space-y-5">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Customer Purchase History</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">Complete invoice-wise purchase history by mobile number</p>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input data-testid="history-mobile-input" placeholder="Enter customer mobile number..." value={mobile}
              onChange={e => setMobile(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="pl-9 font-body text-sm rounded-sm font-mono" maxLength={10} /></div>
          <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={handleSearch} disabled={loading} data-testid="history-search-btn">
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </CardContent>
      </Card>

      {data && !data.customer && (
        <Card className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-16 text-center">
          <User className="w-10 h-10 text-slate-200 mx-auto mb-2" />
          <p className="text-sm text-slate-400 font-body">No customer found with mobile: {mobile}</p>
        </CardContent></Card>
      )}

      {data?.customer && (
        <>
          {/* Customer Info */}
          <Card className="border-sky-200 bg-sky-50/30 shadow-sm rounded-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-sky-100 rounded-full flex items-center justify-center">
                  <User className="w-6 h-6 text-sky-600" />
                </div>
                <div>
                  <p className="text-lg font-heading font-bold text-slate-900">{data.customer.name}</p>
                  <p className="text-sm font-mono text-slate-500">{data.customer.mobile} | {data.customer.store}</p>
                </div>
              </div>
              <div className="flex gap-4 text-right">
                <div><p className="text-[10px] font-body text-slate-400 uppercase">Total Spent</p><p className="text-lg font-heading font-bold text-emerald-700">INR {data.total_spent.toLocaleString('en-IN')}</p></div>
                <div><p className="text-[10px] font-body text-slate-400 uppercase">Invoices</p><p className="text-lg font-heading font-bold text-slate-900">{data.total_invoices}</p></div>
                <div><p className="text-[10px] font-body text-slate-400 uppercase">Items</p><p className="text-lg font-heading font-bold text-slate-900">{data.total_items}</p></div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Badge className={`text-xs rounded-sm ${data.customer.type === 'rc' || data.customer.type === 'CHRONIC' ? 'bg-rose-50 text-rose-700' : data.customer.type === 'HIGH_VALUE' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{data.customer.type}</Badge>
            {data.customer.chronic_tags?.map(t => <Badge key={t} className="text-xs rounded-sm bg-violet-50 text-violet-700">{t.replace('_', ' ')}</Badge>)}
            <Badge className={`text-xs rounded-sm ${data.customer.adherence === 'high' ? 'bg-emerald-50 text-emerald-700' : data.customer.adherence === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>Adherence: {data.customer.adherence}</Badge>
            <Button variant="outline" size="sm" className="rounded-sm font-body text-xs ml-auto" onClick={() => navigate(`/crm/customer/${data.customer.id}`)}>
              View Full Profile
            </Button>
          </div>

          {/* Invoices */}
          {data.invoices.length === 0 ? (
            <Card className="border-slate-200 shadow-sm rounded-sm"><CardContent className="p-12 text-center">
              <Receipt className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400 font-body">No purchase records found</p>
            </CardContent></Card>
          ) : data.invoices.map((inv, idx) => (
            <Card key={idx} className="border-slate-200 shadow-sm rounded-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-slate-400" />
                    Invoice: {inv.entry_number || 'N/A'}
                  </CardTitle>
                  <div className="flex items-center gap-3 text-[11px] font-body text-slate-500">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '-'}</span>
                    <span>{inv.store_name}</span>
                    <Badge className="text-[11px] rounded-sm bg-emerald-50 text-emerald-700 font-medium">INR {inv.total_amount.toLocaleString('en-IN')}</Badge>
                  </div>
                </div>
              </CardHeader>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-slate-100">
                      {['Product ID', 'Product', 'Amount', 'Medication Days', 'Next Due'].map(h => (
                        <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-2 ${['Amount'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inv.items.map((item, i) => (
                      <TableRow key={i} className="hover:bg-slate-50/50">
                        <TableCell className="font-mono text-[11px] text-slate-500">{item.product_id || '-'}</TableCell>
                        <TableCell className="font-body text-[13px] font-medium text-slate-800">{item.product_name}</TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums">INR {item.amount.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-[12px] tabular-nums">{item.days_of_medication ? `${item.days_of_medication}d` : <span className="text-amber-500">Pending</span>}</TableCell>
                        <TableCell className="text-[11px] text-slate-500">{item.next_due_date ? new Date(item.next_due_date).toLocaleDateString() : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
