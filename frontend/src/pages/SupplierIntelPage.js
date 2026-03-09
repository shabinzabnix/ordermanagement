import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Truck, Search, ChevronLeft, ChevronRight, User, Phone, Mail, Package, Clock, Save, Edit3, IndianRupee, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Pagination } from '../components/Pagination';
import { toast } from 'sonner';

export default function SupplierIntelPage() {
  const [data, setData] = useState({ suppliers: [], best_per_product: [], total_suppliers: 0, total_best_per_product: 0 });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const limit = 100;
  const timerRef = useRef(null);

  // Sub-category state
  const [subCats, setSubCats] = useState([]);
  const [subCatSearch, setSubCatSearch] = useState('');
  const [expandedSc, setExpandedSc] = useState(null);

  // Supplier profile state
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 500);
  };

  useEffect(() => {
    setLoading(true);
    const params = { page, limit };
    if (debouncedSearch) params.search = debouncedSearch;
    api.get('/intel/supplier-intelligence', { params }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  useEffect(() => {
    if (activeTab === 'subcategory') {
      api.get('/intel/subcategory-suppliers', { params: subCatSearch ? { search: subCatSearch } : {} }).then(r => setSubCats(r.data.sub_categories || [])).catch(() => {});
    }
  }, [activeTab, subCatSearch]);

  const openProfile = (supplierName) => {
    setProfileOpen(true); setProfileData(null); setProfileLoading(true); setEditMode(false);
    api.get(`/intel/supplier-profiles/${encodeURIComponent(supplierName)}`).then(r => {
      setProfileData(r.data);
      if (r.data.profile) {
        setEditForm(r.data.profile);
      } else {
        setEditForm({ supplier_name: supplierName, contact_person: '', contact_phone: '', contact_email: '', address: '', gst_number: '', credit_days: 0, sub_categories: r.data.sub_categories?.join(',') || '', return_policy: '', payment_terms: '', notes: '' });
      }
    }).catch(() => toast.error('Failed')).finally(() => setProfileLoading(false));
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const payload = { ...editForm, sub_categories: Array.isArray(editForm.sub_categories) ? editForm.sub_categories.join(',') : editForm.sub_categories };
      await api.post('/intel/supplier-profiles', payload);
      toast.success('Supplier profile saved');
      setEditMode(false);
      // Reload
      api.get(`/intel/supplier-profiles/${encodeURIComponent(editForm.supplier_name)}`).then(r => setProfileData(r.data));
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  if (loading && !data.suppliers.length && page === 1) return <div className="space-y-4"><Skeleton className="h-16 rounded-sm" /><Skeleton className="h-96 rounded-sm" /></div>;

  const totalSuppPages = Math.ceil((data.total_suppliers || 0) / limit);
  const totalBestPages = Math.ceil((data.total_best_per_product || 0) / limit);
  const chartData = data.suppliers.slice(0, 15).map(s => ({ name: s.supplier?.substring(0, 20), products: s.product_count }));

  return (
    <div data-testid="supplier-intel-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Supplier Intelligence</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{data.total_suppliers} suppliers | {data.total_best_per_product} products mapped</p>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Search suppliers or products..." value={search} onChange={e => handleSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" data-testid="supplier-search" /></div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="rounded-sm">
          <TabsTrigger value="overview" className="rounded-sm text-xs font-body">Suppliers ({data.total_suppliers})</TabsTrigger>
          <TabsTrigger value="subcategory" className="rounded-sm text-xs font-body">Sub-Category Map ({subCats.length})</TabsTrigger>
          <TabsTrigger value="best" className="rounded-sm text-xs font-body">Best / Product ({data.total_best_per_product})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {chartData.length > 0 && (
            <Card className="border-slate-200 shadow-sm rounded-sm"><CardHeader className="pb-1"><CardTitle className="text-sm font-heading font-semibold">Top Suppliers by Product Count</CardTitle></CardHeader><CardContent>
              <ResponsiveContainer width="100%" height={200}><BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94A3B8' }} /><YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} /><Tooltip /><Bar dataKey="products" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
              </BarChart></ResponsiveContainer>
            </CardContent></Card>
          )}
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-420px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
                  {['Supplier', 'Products', 'Avg PTR', 'Avg L.Cost', 'Profile'].map(h => (
                    <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['Products', 'Avg PTR', 'Avg L.Cost'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                  ))}
                </TableRow></TableHeader>
                <TableBody>
                  {data.suppliers.map((s, i) => (
                    <TableRow key={i} className="hover:bg-slate-50/50">
                      <TableCell className="font-body text-[13px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => openProfile(s.supplier)}>{s.supplier}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums font-bold text-sky-700">{s.product_count}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{s.avg_ptr.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{s.avg_landing_cost.toFixed(2)}</TableCell>
                      <TableCell><Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px]" onClick={() => openProfile(s.supplier)}><User className="w-3 h-3 mr-0.5" />View</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} totalPages={totalSuppPages} total={data.total_suppliers} onPageChange={setPage} label="suppliers" />
          </Card>
        </TabsContent>

        {/* Sub-Category Map */}
        <TabsContent value="subcategory" className="space-y-4">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="p-3">
              <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input placeholder="Search sub-category or supplier..." value={subCatSearch} onChange={e => setSubCatSearch(e.target.value)} className="pl-9 font-body text-sm rounded-sm" /></div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {subCats.length === 0 ? (
              <Card className="border-slate-200 rounded-sm"><CardContent className="p-12 text-center"><Package className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No sub-categories found</p></CardContent></Card>
            ) : subCats.slice(0, 50).map(sc => (
              <Card key={sc.sub_category} className={`border-slate-200 shadow-sm rounded-sm ${expandedSc === sc.sub_category ? 'ring-2 ring-sky-200' : ''}`}>
                <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50/50"
                  onClick={() => setExpandedSc(expandedSc === sc.sub_category ? null : sc.sub_category)}>
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-[13px] font-heading font-semibold text-slate-800">{sc.sub_category}</p>
                      <p className="text-[10px] font-body text-slate-400">{sc.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[12px] font-body">
                    <span className="text-slate-500">{sc.total_products} products</span>
                    <Badge className="text-[10px] rounded-sm bg-sky-50 text-sky-700">{sc.suppliers.length} supplier{sc.suppliers.length > 1 ? 's' : ''}</Badge>
                  </div>
                </div>

                {expandedSc === sc.sub_category && (
                  <div className="border-t border-slate-100">
                    <Table>
                      <TableHeader><TableRow className="border-b border-slate-100">
                        {['Supplier', 'Products', 'Avg MRP', 'Avg PTR', 'Avg L.Cost', 'Credit Days', 'Contact', 'Return Policy', 'Profile'].map(h => (
                          <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 py-2 ${['Products', 'Avg MRP', 'Avg PTR', 'Avg L.Cost', 'Credit Days'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                        ))}
                      </TableRow></TableHeader>
                      <TableBody>
                        {sc.suppliers.map((s, i) => (
                          <TableRow key={i} className="hover:bg-slate-50/50">
                            <TableCell className="font-body text-[12px] font-medium text-slate-800 cursor-pointer hover:text-sky-600" onClick={() => openProfile(s.supplier)}>{s.supplier}</TableCell>
                            <TableCell className="text-right text-[12px] tabular-nums font-bold text-sky-700">{s.product_count}</TableCell>
                            <TableCell className="text-right text-[11px] tabular-nums">{s.avg_mrp.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-[11px] tabular-nums">{s.avg_ptr.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-[11px] tabular-nums">{s.avg_lcost.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-[12px] tabular-nums font-medium">{s.credit_days > 0 ? <span className="text-amber-700">{s.credit_days}d</span> : <span className="text-slate-300">-</span>}</TableCell>
                            <TableCell className="text-[11px] text-slate-500">{s.contact_person || <span className="text-slate-300">-</span>}</TableCell>
                            <TableCell className="text-[10px] text-slate-500 max-w-[150px] truncate">{s.return_policy || <span className="text-slate-300">-</span>}</TableCell>
                            <TableCell>
                              {s.has_profile ? (
                                <Badge className="text-[8px] rounded-sm bg-emerald-50 text-emerald-700 cursor-pointer" onClick={() => openProfile(s.supplier)}>View</Badge>
                              ) : (
                                <Badge className="text-[8px] rounded-sm bg-amber-50 text-amber-700 cursor-pointer" onClick={() => openProfile(s.supplier)}>Add</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="best">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <div className="overflow-auto max-h-[calc(100vh-340px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10"><TableRow className="border-b-2 border-slate-100">
                  {['Product ID', 'Product Name', 'Best Supplier', 'PTR', 'L.Cost', 'MRP', 'Margin %'].map(h => (
                    <TableHead key={h} className={`text-[10px] uppercase tracking-wider font-bold text-slate-400 py-3 ${['PTR', 'L.Cost', 'MRP', 'Margin %'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                  ))}
                </TableRow></TableHeader>
                <TableBody>
                  {data.best_per_product.map((b, i) => (
                    <TableRow key={i} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-[11px] text-slate-500">{b.product_id}</TableCell>
                      <TableCell className="font-body text-[13px] font-medium text-slate-800">{b.product_name}</TableCell>
                      <TableCell className="text-[12px] text-sky-700 font-medium cursor-pointer hover:underline" onClick={() => openProfile(b.best_supplier)}>{b.best_supplier}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{b.ptr.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{b.landing_cost.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-[12px] tabular-nums">{b.mrp.toFixed(2)}</TableCell>
                      <TableCell className="text-right"><Badge className={`text-[10px] rounded-sm tabular-nums ${b.margin_pct >= 25 ? 'bg-emerald-50 text-emerald-700' : b.margin_pct >= 15 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{b.margin_pct}%</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} totalPages={totalBestPages} total={data.total_best_per_product} onPageChange={setPage} label="products" />
          </Card>
        </TabsContent>
      </Tabs>

      {/* Supplier Profile Popup */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="rounded-sm max-w-2xl max-h-[85vh] overflow-auto p-0">
          {profileLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 text-sky-500 animate-spin mx-auto" /></div>
          ) : profileData ? (
            <>
              <DialogHeader className="px-5 pt-5 pb-0">
                <div className="flex items-center justify-between">
                  <DialogTitle className="font-heading">{profileData.supplier_name}</DialogTitle>
                  {!editMode && <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setEditMode(true)}><Edit3 className="w-3 h-3 mr-1" />Edit Profile</Button>}
                </div>
              </DialogHeader>
              <div className="px-5 pb-5 space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { l: 'Products', v: profileData.product_count, c: 'text-sky-700' },
                    { l: 'Categories', v: profileData.sub_categories?.length || 0, c: 'text-violet-700' },
                    { l: '90d Purchases', v: `INR ${profileData.purchase_90d?.amount?.toLocaleString('en-IN')}`, c: 'text-emerald-700' },
                    { l: 'Credit Days', v: profileData.profile?.credit_days || editForm.credit_days || 0, c: 'text-amber-700' },
                  ].map(k => (
                    <div key={k.l} className="p-2 bg-slate-50 rounded-sm"><p className="text-[8px] text-slate-400 uppercase">{k.l}</p><p className={`text-[14px] font-bold tabular-nums ${k.c}`}>{k.v}</p></div>
                  ))}
                </div>

                {/* Profile Info or Edit Form */}
                {editMode ? (
                  <div className="p-3 border border-sky-200 bg-sky-50/30 rounded-sm space-y-2">
                    <p className="text-[10px] font-body font-medium text-sky-700 uppercase">Supplier Details</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label className="font-body text-[10px]">Contact Person</Label><Input value={editForm.contact_person || ''} onChange={e => setEditForm({...editForm, contact_person: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                      <div><Label className="font-body text-[10px]">Phone</Label><Input value={editForm.contact_phone || ''} onChange={e => setEditForm({...editForm, contact_phone: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                      <div><Label className="font-body text-[10px]">Email</Label><Input value={editForm.contact_email || ''} onChange={e => setEditForm({...editForm, contact_email: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                      <div><Label className="font-body text-[10px]">GST Number</Label><Input value={editForm.gst_number || ''} onChange={e => setEditForm({...editForm, gst_number: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                      <div><Label className="font-body text-[10px]">Credit Days</Label><Input type="number" value={editForm.credit_days || 0} onChange={e => setEditForm({...editForm, credit_days: parseInt(e.target.value) || 0})} className="rounded-sm h-8 text-sm" /></div>
                      <div><Label className="font-body text-[10px]">Payment Terms</Label><Input value={editForm.payment_terms || ''} onChange={e => setEditForm({...editForm, payment_terms: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                    </div>
                    <div><Label className="font-body text-[10px]">Address</Label><Input value={editForm.address || ''} onChange={e => setEditForm({...editForm, address: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                    <div><Label className="font-body text-[10px]">Sub-Categories (comma separated)</Label><Input value={Array.isArray(editForm.sub_categories) ? editForm.sub_categories.join(',') : (editForm.sub_categories || '')} onChange={e => setEditForm({...editForm, sub_categories: e.target.value})} className="rounded-sm h-8 text-sm" /></div>
                    <div><Label className="font-body text-[10px]">Return Policy</Label><Textarea value={editForm.return_policy || ''} onChange={e => setEditForm({...editForm, return_policy: e.target.value})} className="rounded-sm text-sm" rows={2} /></div>
                    <div><Label className="font-body text-[10px]">Notes</Label><Textarea value={editForm.notes || ''} onChange={e => setEditForm({...editForm, notes: e.target.value})} className="rounded-sm text-sm" rows={2} /></div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" className="rounded-sm text-xs h-7" onClick={() => setEditMode(false)}>Cancel</Button>
                      <Button size="sm" className="bg-sky-500 hover:bg-sky-600 rounded-sm text-xs h-7" onClick={handleSaveProfile} disabled={saving}><Save className="w-3 h-3 mr-1" />{saving ? 'Saving...' : 'Save'}</Button>
                    </div>
                  </div>
                ) : profileData.profile ? (
                  <div className="p-3 border border-slate-200 rounded-sm space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-[12px] font-body">
                      {profileData.profile.contact_person && <div className="flex items-center gap-1.5"><User className="w-3 h-3 text-slate-400" /><span className="text-slate-500">Contact:</span><span className="font-medium">{profileData.profile.contact_person}</span></div>}
                      {profileData.profile.contact_phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3 text-slate-400" /><span className="font-medium">{profileData.profile.contact_phone}</span></div>}
                      {profileData.profile.contact_email && <div className="flex items-center gap-1.5"><Mail className="w-3 h-3 text-slate-400" /><span className="font-medium">{profileData.profile.contact_email}</span></div>}
                      {profileData.profile.gst_number && <div><span className="text-slate-500">GST:</span> <span className="font-medium">{profileData.profile.gst_number}</span></div>}
                      {profileData.profile.address && <div className="col-span-2"><span className="text-slate-500">Address:</span> <span>{profileData.profile.address}</span></div>}
                      {profileData.profile.payment_terms && <div className="col-span-2"><span className="text-slate-500">Payment:</span> <span>{profileData.profile.payment_terms}</span></div>}
                    </div>
                    {profileData.profile.return_policy && (
                      <div className="pt-2 border-t border-slate-100"><p className="text-[10px] text-slate-400 uppercase mb-1">Return Policy</p><p className="text-[12px] font-body text-slate-600">{profileData.profile.return_policy}</p></div>
                    )}
                    {profileData.profile.notes && (
                      <div className="pt-2 border-t border-slate-100"><p className="text-[10px] text-slate-400 uppercase mb-1">Notes</p><p className="text-[12px] font-body text-slate-600">{profileData.profile.notes}</p></div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-sm text-center">
                    <p className="text-[12px] font-body text-amber-700">No profile created yet. Click "Edit Profile" to add supplier details.</p>
                  </div>
                )}

                {/* Sub-categories */}
                {profileData.sub_categories?.length > 0 && (
                  <div className="p-3 border border-slate-200 rounded-sm">
                    <p className="text-[10px] font-body text-slate-500 uppercase tracking-wider mb-1.5">Sub-Categories ({profileData.sub_categories.length})</p>
                    <div className="flex gap-1 flex-wrap">{profileData.sub_categories.map(c => <Badge key={c} className="text-[9px] rounded-sm bg-violet-50 text-violet-700">{c}</Badge>)}</div>
                  </div>
                )}

                {/* Products */}
                {profileData.products?.length > 0 && (
                  <div className="p-3 border border-slate-200 rounded-sm">
                    <p className="text-[10px] font-body text-sky-700 uppercase tracking-wider mb-1.5"><Package className="w-3 h-3 inline mr-1" />Products ({profileData.product_count})</p>
                    <div className="max-h-[200px] overflow-auto space-y-1">
                      {profileData.products.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px] font-body border-b border-slate-50 py-1">
                          <span className="text-slate-700">{p.product_name}</span>
                          <div className="flex gap-3 text-slate-400 tabular-nums">
                            <span>MRP {p.mrp.toFixed(2)}</span><span>PTR {p.ptr.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
