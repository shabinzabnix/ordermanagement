import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Skeleton } from '../components/ui/skeleton';
import { toast } from 'sonner';
import { Users, Search, ChevronLeft, ChevronRight, User, Receipt, Calendar, Pill, IndianRupee, Phone } from 'lucide-react';

export default function StoreCustomerListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('name');
  const [loading, setLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const limit = 50;

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); }, []);
  useEffect(() => {
    if (['STORE_STAFF','STORE_MANAGER'].includes(user?.role) && user?.store_id) setSelectedStore(String(user.store_id));
  }, [user]);

  useEffect(() => {
    if (!selectedStore && !search) { setCustomers([]); setTotal(0); return; }
    setLoading(true);
    const params = { page, limit, sort_by: sortBy };
    if (selectedStore) params.store_id = selectedStore;
    if (search) params.search = search;
    api.get('/crm/customers', { params }).then(r => { setCustomers(r.data.customers); setTotal(r.data.total); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [selectedStore, search, page, sortBy]);

  const loadProfile = async (mobile) => {
    setProfileLoading(true);
    setProfileOpen(true);
    try {
      const res = await api.get(`/crm/purchase-history/${mobile}`);
      setProfile(res.data);
    } catch { toast.error('Failed to load profile'); setProfileOpen(false); }
    finally { setProfileLoading(false); }
  };

  const totalPages = Math.ceil(total / limit);
  const typeBadge = (t) => ({ rc: 'bg-rose-50 text-rose-700', CHRONIC: 'bg-violet-50 text-violet-700', HIGH_VALUE: 'bg-amber-50 text-amber-700', WALKIN: 'bg-slate-100 text-slate-600', walkin: 'bg-slate-100 text-slate-600' }[t] || 'bg-slate-100 text-slate-600');

  return (
    <div data-testid="store-customer-list-page" className="space-y-5">
      <div>
        <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Store Customer List</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">Search customers by name, mobile, or product across stores</p>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3 flex-wrap">
          <Select value={selectedStore} onValueChange={v => { setSelectedStore(v === 'all' ? '' : v); setPage(1); }}>
            <SelectTrigger className="w-[220px] font-body text-sm rounded-sm" data-testid="customer-store-filter"><SelectValue placeholder="Select Store" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name} ({s.store_code})</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[250px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input data-testid="customer-search" placeholder="Search name, mobile, or product..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 font-body text-sm rounded-sm" /></div>
          <Select value={sortBy} onValueChange={v => { setSortBy(v); setPage(1); }}>
            <SelectTrigger className="w-[160px] font-body text-sm rounded-sm" data-testid="customer-sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort: Name</SelectItem>
              <SelectItem value="invoices">Sort: Invoices</SelectItem>
              <SelectItem value="spent">Sort: Amount Spent</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-300px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                {['Name', 'Mobile', 'Store', 'Type', 'Invoices', 'Total Spent', 'Medicines', 'Tags', ''].map(h => (
                  <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Invoices', 'Total Spent', 'Medicines'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? [...Array(8)].map((_, i) => (
                <TableRow key={i}>{[...Array(8)].map((_, j) => <TableCell key={j}><div className="h-4 bg-slate-50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : customers.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-16">
                  <Users className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">{selectedStore || search ? 'No customers found' : 'Select a store or search'}</p>
                </TableCell></TableRow>
              ) : customers.map(c => (
                <TableRow key={c.id} className="hover:bg-slate-50/50" data-testid={`cust-row-${c.id}`}>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{c.customer_name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">{c.mobile_number}</TableCell>
                  <TableCell className="text-[12px] text-slate-500">{c.store_name}</TableCell>
                  <TableCell><Badge className={`text-[9px] rounded-sm ${typeBadge(c.customer_type)}`}>{(c.customer_type || 'walkin').replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium">{c.invoice_count || 0}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums font-medium text-emerald-700">{c.total_spent > 0 ? `INR ${c.total_spent.toLocaleString('en-IN')}` : '-'}</TableCell>
                  <TableCell className="text-right text-[12px] tabular-nums">{c.active_medicines}</TableCell>
                  <TableCell><div className="flex gap-0.5 flex-wrap">{c.chronic_tags?.map(t => <Badge key={t} className="text-[8px] rounded-sm bg-violet-50 text-violet-700 px-1">{t.replace('_',' ')}</Badge>)}</div></TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] font-body"
                      onClick={() => loadProfile(c.mobile_number)} data-testid={`view-profile-${c.id}`}>Profile</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 font-body">Page {page}/{totalPages} | {total} customers</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="h-7 w-7 p-0 rounded-sm"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages} className="h-7 w-7 p-0 rounded-sm"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>

      {/* Customer Profile Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="rounded-sm max-w-3xl max-h-[85vh] overflow-auto">
          {profileLoading ? (
            <div className="space-y-4 p-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-sm" />)}</div>
          ) : profile?.customer ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading flex items-center gap-3">
                  <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-sky-600" /></div>
                  <div>
                    <p className="text-lg">{profile.customer.name}</p>
                    <p className="text-sm font-normal text-slate-500 font-mono">{profile.customer.mobile} | {profile.customer.store}</p>
                  </div>
                </DialogTitle>
              </DialogHeader>

              {/* Summary KPIs */}
              <div className="grid grid-cols-4 gap-3 mt-2">
                {[
                  { l: 'Total Spent', v: `INR ${profile.total_spent.toLocaleString('en-IN')}`, icon: IndianRupee, fg: 'text-emerald-600' },
                  { l: 'Invoices', v: profile.total_invoices, icon: Receipt, fg: 'text-sky-600' },
                  { l: 'Items Purchased', v: profile.total_items, icon: Pill, fg: 'text-violet-600' },
                  { l: 'Type', v: profile.customer.type?.replace('_', ' '), icon: User, fg: 'text-amber-600' },
                ].map(k => (
                  <div key={k.l} className="bg-slate-50 rounded-sm p-3">
                    <p className="text-[10px] font-body text-slate-400 uppercase tracking-wider">{k.l}</p>
                    <p className="text-lg font-heading font-bold text-slate-900 mt-0.5 tabular-nums">{k.v}</p>
                  </div>
                ))}
              </div>

              {profile.customer.chronic_tags?.length > 0 && (
                <div className="flex gap-1.5 mt-2">
                  {profile.customer.chronic_tags.map(t => <Badge key={t} className="text-xs rounded-sm bg-violet-100 text-violet-700">{t.replace('_', ' ')}</Badge>)}
                  <Badge className={`text-xs rounded-sm ${profile.customer.adherence === 'high' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>Adherence: {profile.customer.adherence}</Badge>
                </div>
              )}

              {/* Invoice-wise Purchases */}
              <div className="mt-4 space-y-3">
                <h3 className="text-sm font-heading font-semibold text-slate-700">Purchase History ({profile.total_invoices} invoices)</h3>
                {profile.invoices.length === 0 ? (
                  <p className="text-sm text-slate-400 font-body text-center py-6">No purchase records</p>
                ) : profile.invoices.map((inv, idx) => (
                  <Card key={idx} className="border-slate-200 rounded-sm">
                    <CardHeader className="py-2 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[12px] font-body">
                          <Receipt className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-medium text-slate-700">Invoice: {inv.entry_number || 'N/A'}</span>
                          <span className="text-slate-400">|</span>
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span className="text-slate-500">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '-'}</span>
                          <span className="text-slate-400">|</span>
                          <span className="text-slate-500">{inv.store_name}</span>
                        </div>
                        <Badge className="text-[11px] rounded-sm bg-emerald-50 text-emerald-700 font-medium tabular-nums">INR {inv.total_amount.toLocaleString('en-IN')}</Badge>
                      </div>
                    </CardHeader>
                    <div className="px-4 pb-2">
                      <Table>
                        <TableBody>
                          {inv.items.map((item, i) => (
                            <TableRow key={i} className="border-b border-slate-50 last:border-0">
                              <TableCell className="py-1.5 font-body text-[12px] text-slate-700">{item.product_name}</TableCell>
                              <TableCell className="py-1.5 font-mono text-[10px] text-slate-400 w-[80px]">{item.product_id || '-'}</TableCell>
                              <TableCell className="py-1.5 text-right text-[12px] tabular-nums w-[90px]">INR {item.amount.toLocaleString('en-IN')}</TableCell>
                              <TableCell className="py-1.5 text-right text-[11px] w-[70px]">{item.days_of_medication ? <Badge className="text-[9px] rounded-sm bg-sky-50 text-sky-700">{item.days_of_medication}d</Badge> : <span className="text-slate-300">-</span>}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                ))}
              </div>

              <div className="flex justify-end mt-3">
                <Button variant="outline" size="sm" className="rounded-sm font-body text-xs" onClick={() => { setProfileOpen(false); navigate(`/crm/customer/${profile.customer.id}`); }}>
                  Open Full CRM Profile
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-10"><User className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">Customer not found</p></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
