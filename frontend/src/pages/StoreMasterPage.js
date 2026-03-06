import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { toast } from 'sonner';
import { Building2, Plus } from 'lucide-react';

export default function StoreMasterPage() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ store_name: '', location: '', manager_name: '', contact_number: '', store_code: '' });
  const [saving, setSaving] = useState(false);

  const loadStores = async () => {
    try { const res = await api.get('/stores'); setStores(res.data.stores); }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { loadStores(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/stores', form);
      toast.success('Store created');
      setOpen(false);
      setForm({ store_name: '', location: '', manager_name: '', contact_number: '', store_code: '' });
      loadStores();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div data-testid="store-master-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Store Master</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{stores.length} stores in the network</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-store-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Store
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-sm">
            <DialogHeader><DialogTitle className="font-heading">Create New Store</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Store Name *</Label>
                  <Input data-testid="store-name-input" value={form.store_name} onChange={e => setForm({...form, store_name: e.target.value})} required className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Store Code *</Label>
                  <Input data-testid="store-code-input" value={form.store_code} onChange={e => setForm({...form, store_code: e.target.value})} required className="rounded-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="font-body text-xs">Location</Label>
                <Input data-testid="store-location-input" value={form.location} onChange={e => setForm({...form, location: e.target.value})} className="rounded-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Manager Name</Label>
                  <Input data-testid="store-manager-input" value={form.manager_name} onChange={e => setForm({...form, manager_name: e.target.value})} className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Contact Number</Label>
                  <Input data-testid="store-contact-input" value={form.contact_number} onChange={e => setForm({...form, contact_number: e.target.value})} className="rounded-sm" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="save-store-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>
                  {saving ? 'Creating...' : 'Create Store'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-sm">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-slate-100">
                {['Store Code', 'Store Name', 'Location', 'Manager', 'Contact'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-16">
                  <Building2 className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No stores added yet</p>
                </TableCell></TableRow>
              ) : stores.map(s => (
                <TableRow key={s.id} className="hover:bg-slate-50/50" data-testid={`store-row-${s.store_code}`}>
                  <TableCell className="font-mono text-[11px] font-medium text-slate-800">{s.store_code}</TableCell>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{s.store_name}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{s.location || '-'}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{s.manager_name || '-'}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{s.contact_number || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
