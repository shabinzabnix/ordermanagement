import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { toast } from 'sonner';
import { Users, Plus } from 'lucide-react';

const ALL_SERVICES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'store_dashboard', label: 'Store Dashboard' },
  { key: 'top_selling', label: 'Top Selling' },
  { key: 'intelligence', label: 'Intelligence Center' },
  { key: 'forecast', label: 'Demand Forecast' },
  { key: 'expiry_risk', label: 'Expiry Risk' },
  { key: 'suppliers', label: 'Supplier Intelligence' },
  { key: 'products', label: 'Product Master' },
  { key: 'stores', label: 'Store Master' },
  { key: 'ho_stock', label: 'HO Stock' },
  { key: 'store_stock', label: 'Store Stock' },
  { key: 'consolidated', label: 'Consolidated Stock' },
  { key: 'scorecard', label: 'Store Scorecard' },
  { key: 'aging', label: 'Aging Report' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'purchases', label: 'Purchase Requests' },
  { key: 'purchase_upload', label: 'Purchase Upload' },
  { key: 'crm', label: 'CRM Dashboard' },
  { key: 'sales_upload', label: 'Sales Upload' },
  { key: 'refill_due', label: 'Refill Due' },
  { key: 'crm_reports', label: 'CRM Reports' },
  { key: 'crm_history', label: 'Customer History' },
  { key: 'crm_customers', label: 'Customer List' },
  { key: 'users', label: 'User Management' },
  { key: 'audit_log', label: 'Audit Log' },
  { key: 'uploads', label: 'Upload History' },
];

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: '', store_id: '' });
  const [selectedServices, setSelectedServices] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadUsers = () => { api.get('/users').then(r => setUsers(r.data.users)).catch(() => {}); };
  useEffect(() => {
    loadUsers();
    api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {});
  }, []);

  const toggleService = (key) => {
    setSelectedServices(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]);
  };

  const selectAllServices = () => setSelectedServices(ALL_SERVICES.map(s => s.key));
  const clearAllServices = () => setSelectedServices([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, allowed_services: selectedServices.join(',') };
      if (payload.store_id) payload.store_id = parseInt(payload.store_id);
      else delete payload.store_id;
      await api.post('/users', payload);
      toast.success('User created');
      setOpen(false);
      setForm({ email: '', password: '', full_name: '', role: '', store_id: '' });
      setSelectedServices([]);
      loadUsers();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const roleColor = (r) => {
    if (r === 'ADMIN') return 'bg-violet-50 text-violet-700';
    if (r === 'HO_STAFF' || r === 'DIRECTOR') return 'bg-sky-50 text-sky-700';
    if (r === 'CRM_STAFF') return 'bg-rose-50 text-rose-700';
    return 'bg-emerald-50 text-emerald-700';
  };

  return (
    <div data-testid="user-management-page" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">User Management</h2>
          <p className="text-sm font-body text-slate-500 mt-0.5">{users.length} users in the system</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-user-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-sm max-w-2xl max-h-[85vh] overflow-auto">
            <DialogHeader><DialogTitle className="font-heading">Create User</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Full Name *</Label>
                  <Input data-testid="user-name-input" value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} required className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Email *</Label>
                  <Input data-testid="user-email-input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required className="rounded-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Password *</Label>
                  <Input data-testid="user-password-input" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Role *</Label>
                  <Select value={form.role} onValueChange={v => setForm({...form, role: v})}>
                    <SelectTrigger data-testid="user-role-select" className="rounded-sm"><SelectValue placeholder="Select role" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="HO_STAFF">HO Staff</SelectItem>
                      <SelectItem value="STORE_MANAGER">Store Manager</SelectItem>
                      <SelectItem value="STORE_STAFF">Store Staff</SelectItem>
                      <SelectItem value="CRM_STAFF">CRM Staff</SelectItem>
                      <SelectItem value="DIRECTOR">Director</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(form.role === 'STORE_STAFF' || form.role === 'STORE_MANAGER' || form.role === 'CRM_STAFF') && (
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Assigned Store</Label>
                  <Select value={form.store_id} onValueChange={v => setForm({...form, store_id: v})}>
                    <SelectTrigger className="rounded-sm" data-testid="user-store-select"><SelectValue placeholder="Select store" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              {/* Service Access Selection - only for Admin, HO Staff, CRM Staff */}
              {form.role && form.role !== 'STORE_STAFF' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-body text-xs font-medium">Allowed Services / Modules</Label>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-6 px-2 rounded-sm text-[10px] font-body" onClick={selectAllServices}>Select All</Button>
                    <Button type="button" variant="outline" size="sm" className="h-6 px-2 rounded-sm text-[10px] font-body" onClick={clearAllServices}>Clear All</Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 p-3 border border-slate-200 rounded-sm bg-slate-50/50 max-h-[250px] overflow-auto">
                  {ALL_SERVICES.map(svc => (
                    <label key={svc.key} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1.5 rounded-sm transition-colors">
                      <Checkbox
                        checked={selectedServices.includes(svc.key)}
                        onCheckedChange={() => toggleService(svc.key)}
                        data-testid={`svc-${svc.key}`}
                        className="rounded-sm"
                      />
                      <span className="text-[11px] font-body text-slate-700">{svc.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] font-body text-slate-400">{selectedServices.length} of {ALL_SERVICES.length} services selected. Leave empty for default role-based access.</p>
              </div>
              )}

              {form.role === 'STORE_STAFF' && (
                <p className="text-[11px] font-body text-slate-500 bg-slate-50 p-3 rounded-sm">Store Staff gets access to all store-related modules for their assigned store automatically.</p>
              )}

              <DialogFooter>
                <Button type="submit" data-testid="save-user-btn" className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" disabled={saving}>
                  {saving ? 'Creating...' : 'Create User'}
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
                {['Name', 'Email', 'Role', 'Services', 'Status'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-16">
                  <Users className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No users</p>
                </TableCell></TableRow>
              ) : users.map(u => (
                <TableRow key={u.id} className="hover:bg-slate-50/50" data-testid={`user-row-${u.id}`}>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{u.full_name}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{u.email}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${roleColor(u.role)}`}>{u.role?.replace('_', ' ')}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-0.5 flex-wrap max-w-[250px]">
                      {u.allowed_services ? u.allowed_services.split(',').slice(0, 5).map(s => (
                        <Badge key={s} variant="secondary" className="text-[8px] rounded-sm px-1">{s.replace('_', ' ')}</Badge>
                      )) : <span className="text-[10px] text-slate-400">All (role default)</span>}
                      {u.allowed_services && u.allowed_services.split(',').length > 5 && (
                        <Badge variant="secondary" className="text-[8px] rounded-sm px-1">+{u.allowed_services.split(',').length - 5}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={u.is_active ? 'secondary' : 'destructive'} className="text-[10px] rounded-sm">{u.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
