import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { toast } from 'sonner';
import { ClipboardList, Check, Settings, Plus, Trash2 } from 'lucide-react';

export default function PurchaseReviewPage() {
  const [items, setItems] = useState([]);
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState([]);
  const [rules, setRules] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [ruleDialog, setRuleDialog] = useState(false);
  const [ruleForm, setRuleForm] = useState({ po_category: '', sub_categories: [] });
  const [bulkSupplier, setBulkSupplier] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');

  const loadItems = () => {
    const params = {};
    if (catFilter !== 'all') params.po_category = catFilter;
    if (statusFilter !== 'all') params.status = statusFilter;
    api.get('/po/purchase-review', { params }).then(r => setItems(r.data.items)).catch(() => {});
  };
  const loadRules = () => { api.get('/po/category-rules').then(r => setRules(r.data.rules)).catch(() => {}); };
  useEffect(() => { loadItems(); loadRules(); api.get('/products/sub-categories').then(r => setSubCategories(r.data.sub_categories || [])).catch(() => {}); }, []);
  useEffect(() => { loadItems(); }, [catFilter, statusFilter]);

  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const selectAll = () => setSelected(items.map(i => i.id));
  const clearSelect = () => setSelected([]);

  const handleBulkUpdate = async () => {
    if (selected.length === 0) { toast.error('Select items first'); return; }
    try {
      await api.put('/po/purchase-review/update', { item_ids: selected, supplier: bulkSupplier || null, status: bulkStatus || null });
      toast.success(`Updated ${selected.length} items`);
      setSelected([]); setBulkSupplier(''); setBulkStatus('');
      loadItems();
    } catch { toast.error('Failed'); }
  };

  const updateSingleSupplier = async (itemId, supplier) => {
    try {
      await api.put('/po/purchase-review/update', { item_ids: [itemId], supplier });
      toast.success('Supplier assigned');
      loadItems();
    } catch { toast.error('Failed'); }
  };

  const updateSingleStatus = async (itemId, status) => {
    try {
      await api.put('/po/purchase-review/update', { item_ids: [itemId], status });
      loadItems();
    } catch { toast.error('Failed'); }
  };

  const saveRule = async () => {
    if (!ruleForm.po_category || ruleForm.sub_categories.length === 0) return;
    try {
      await api.post('/po/category-rules', ruleForm);
      toast.success('Rule saved');
      setRuleDialog(false); setRuleForm({ po_category: '', sub_categories: [] });
      loadRules();
    } catch { toast.error('Failed'); }
  };

  const deleteRule = async (id) => {
    try { await api.delete(`/po/category-rules/${id}`); toast.success('Rule deleted'); loadRules(); } catch {}
  };

  const toggleSubCat = (sc) => {
    setRuleForm(f => ({ ...f, sub_categories: f.sub_categories.includes(sc) ? f.sub_categories.filter(s => s !== sc) : [...f.sub_categories, sc] }));
  };

  const sBadge = (s) => ({ approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-red-50 text-red-700', ordered: 'bg-sky-50 text-sky-700' }[s] || 'bg-amber-50 text-amber-700');
  const cBadge = (c) => ({ 'BRAND-RX': 'bg-blue-50 text-blue-700', 'GEN-RX': 'bg-violet-50 text-violet-700', 'OTC': 'bg-emerald-50 text-emerald-700', 'OTX': 'bg-amber-50 text-amber-700' }[c] || 'bg-slate-100 text-slate-600');

  return (
    <div data-testid="purchase-review-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Purchase Review</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">Review products by PO category with supplier selection</p>
        </div>
        <Button variant="outline" className="rounded-sm font-body text-xs" onClick={() => setRuleDialog(true)}>
          <Settings className="w-3.5 h-3.5 mr-1.5" /> Category Rules
        </Button>
      </div>

      {/* Current Rules */}
      {rules.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {rules.map(r => (
            <Badge key={r.id} className={`text-[10px] rounded-sm px-2 py-1 ${cBadge(r.po_category)}`}>
              {r.po_category}: {r.sub_categories?.length} sub-categories
            </Badge>
          ))}
        </div>
      )}

      {/* Filters + Bulk Actions */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <CardContent className="p-3 flex gap-3 flex-wrap items-end">
          <div className="flex gap-1.5">
            {['all', 'BRAND-RX', 'GEN-RX', 'OTC', 'OTX'].map(c => (
              <Button key={c} variant={catFilter === c ? 'default' : 'outline'} size="sm"
                className={`rounded-sm font-body text-xs ${catFilter === c ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
                onClick={() => setCatFilter(c)}>{c === 'all' ? 'All' : c}</Button>
            ))}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[120px] font-body text-sm rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="ordered">Ordered</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent>
          </Select>
          {selected.length > 0 && (
            <div className="flex gap-2 items-center ml-auto border-l pl-3 border-slate-200">
              <span className="text-[11px] font-body text-sky-700 font-medium">{selected.length} selected</span>
              <Input placeholder="Assign supplier..." value={bulkSupplier} onChange={e => setBulkSupplier(e.target.value)} className="w-[160px] h-7 rounded-sm text-sm" />
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger className="w-[100px] h-7 text-[10px] rounded-sm"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent><SelectItem value="approved">Approve</SelectItem><SelectItem value="ordered">Ordered</SelectItem><SelectItem value="rejected">Reject</SelectItem></SelectContent>
              </Select>
              <Button size="sm" className="h-7 bg-sky-500 hover:bg-sky-600 rounded-sm text-xs" onClick={handleBulkUpdate}>Apply</Button>
              <Button size="sm" variant="ghost" className="h-7 rounded-sm text-xs" onClick={clearSelect}>Clear</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto max-h-[calc(100vh-320px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b-2 border-slate-100">
                <TableHead className="w-[30px] py-3"><Checkbox checked={selected.length === items.length && items.length > 0} onCheckedChange={v => v ? selectAll() : clearSelect()} className="rounded-sm" /></TableHead>
                {['Store', 'Product', 'ID', 'Category', 'Qty', 'L.Cost', 'Primary', 'Secondary', 'Selected Supplier', 'Status'].map(h => (
                  <TableHead key={h} className={`text-[9px] uppercase tracking-wider font-bold text-slate-400 font-body py-3 ${['Qty', 'L.Cost'].includes(h) ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center py-16"><ClipboardList className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No items. Configure category rules and submit store requests.</p></TableCell></TableRow>
              ) : items.map(it => (
                <TableRow key={it.id} className={`hover:bg-slate-50/50 ${selected.includes(it.id) ? 'bg-sky-50/50' : ''}`}>
                  <TableCell className="py-1.5"><Checkbox checked={selected.includes(it.id)} onCheckedChange={() => toggleSelect(it.id)} className="rounded-sm" /></TableCell>
                  <TableCell className="text-[11px] text-slate-600">{it.store_name}</TableCell>
                  <TableCell className="text-[12px] font-medium text-slate-800 max-w-[180px] truncate">{it.product_name}</TableCell>
                  <TableCell className="font-mono text-[10px] text-slate-400">{it.product_id || '-'}</TableCell>
                  <TableCell><Badge className={`text-[8px] rounded-sm ${cBadge(it.po_category)}`}>{it.po_category}</Badge></TableCell>
                  <TableCell className="text-right text-[11px] tabular-nums">{it.quantity}</TableCell>
                  <TableCell className="text-right text-[11px] tabular-nums">{it.landing_cost?.toFixed(2)}</TableCell>
                  <TableCell className="text-[10px] text-slate-600 cursor-pointer hover:text-sky-600" onClick={() => updateSingleSupplier(it.id, it.suppliers?.primary)}>{it.suppliers?.primary || '-'}</TableCell>
                  <TableCell className="text-[10px] text-slate-500 cursor-pointer hover:text-sky-600" onClick={() => updateSingleSupplier(it.id, it.suppliers?.secondary)}>{it.suppliers?.secondary || '-'}</TableCell>
                  <TableCell>
                    {it.selected_supplier ? (
                      <Badge className="text-[9px] rounded-sm bg-emerald-50 text-emerald-700">{it.selected_supplier}</Badge>
                    ) : (
                      <Select value="" onValueChange={v => updateSingleSupplier(it.id, v)}>
                        <SelectTrigger className="h-5 w-[80px] text-[9px] rounded-sm px-1"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(it.suppliers || {}).map(([type, name]) => name && <SelectItem key={type} value={name}>{name} ({type})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select value="" onValueChange={v => updateSingleStatus(it.id, v)}>
                      <SelectTrigger className={`h-5 w-[70px] text-[9px] rounded-sm px-1 ${sBadge(it.item_status)}`}><SelectValue placeholder={it.item_status} /></SelectTrigger>
                      <SelectContent><SelectItem value="approved">Approve</SelectItem><SelectItem value="ordered">Ordered</SelectItem><SelectItem value="rejected">Reject</SelectItem></SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Category Rules Dialog */}
      <Dialog open={ruleDialog} onOpenChange={setRuleDialog}>
        <DialogContent className="rounded-sm max-w-xl max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle className="font-heading">PO Category Rules</DialogTitle></DialogHeader>
          <p className="text-[11px] font-body text-slate-500">Map sub-categories from Product Master to PO categories (BRAND-RX, GEN-RX, OTC, OTX). Products with these sub-categories will auto-route to Purchase Review.</p>
          {/* Existing rules */}
          {rules.length > 0 && (
            <div className="space-y-2">
              {rules.map(r => (
                <div key={r.id} className="flex items-start justify-between p-2 border border-slate-200 rounded-sm">
                  <div>
                    <Badge className={`text-[10px] rounded-sm ${cBadge(r.po_category)}`}>{r.po_category}</Badge>
                    <div className="flex gap-1 flex-wrap mt-1">{r.sub_categories?.map(sc => <Badge key={sc} variant="secondary" className="text-[8px] rounded-sm">{sc}</Badge>)}</div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={() => deleteRule(r.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
          )}
          {/* New rule */}
          <div className="space-y-3 border-t pt-3 border-slate-200">
            <div className="space-y-1.5"><Label className="font-body text-xs">PO Category</Label>
              <Select value={ruleForm.po_category} onValueChange={v => setRuleForm({...ruleForm, po_category: v})}>
                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent><SelectItem value="BRAND-RX">BRAND-RX</SelectItem><SelectItem value="GEN-RX">GEN-RX</SelectItem><SelectItem value="OTC">OTC</SelectItem><SelectItem value="OTX">OTX</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label className="font-body text-xs">Sub-Categories ({ruleForm.sub_categories.length} selected)</Label>
              <div className="max-h-[200px] overflow-auto border border-slate-200 rounded-sm p-2 grid grid-cols-2 gap-1">
                {subCategories.map(sc => (
                  <label key={sc} className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 p-1 rounded-sm text-[10px] font-body">
                    <Checkbox checked={ruleForm.sub_categories.includes(sc)} onCheckedChange={() => toggleSubCat(sc)} className="rounded-sm h-3.5 w-3.5" />
                    {sc}
                  </label>
                ))}
              </div></div>
          </div>
          <DialogFooter>
            <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={saveRule} disabled={!ruleForm.po_category || ruleForm.sub_categories.length === 0}>Save Rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
