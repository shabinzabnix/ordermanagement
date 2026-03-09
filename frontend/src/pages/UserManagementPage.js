import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
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
import { Users, Plus, Edit3, LogIn, ShieldOff, ShieldCheck } from 'lucide-react';

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
  const { switchToUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: '', store_id: '' });
  const [selectedServices, setSelectedServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '', role: '', store_id: '', password: '', is_active: true });

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
    if (r === 'STORE_MANAGER') return 'bg-amber-50 text-amber-700';
    return 'bg-emerald-50 text-emerald-700';
  };

  const openEditUser = (u) => {
    setEditUser(u);
    setEditForm({ full_name: u.full_name, role: u.role, store_id: u.store_id ? String(u.store_id) : '', password: '', is_active: u.is_active });
  };
  const handleEditUser = async () => {
    if (!editUser) return; setSaving(true);
    try {
      const payload = { full_name: editForm.full_name, role: editForm.role, is_active: editForm.is_active };
      if (editForm.store_id) payload.store_id = parseInt(editForm.store_id);
      if (editForm.password) payload.password = editForm.password;
      await api.put(`/users/${editUser.id}`, payload);
      toast.success('User updated'); setEditUser(null); loadUsers();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };
  const handleToggleActive = async (u) => {
    const action = u.is_active ? 'disable' : 'enable';
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} user "${u.full_name}"?`)) return;
    try { await api.put(`/users/${u.id}`, { is_active: !u.is_active }); toast.success(`User ${action}d`); loadUsers(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
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
              {(form.role === 'STORE_STAFF' || form.role === 'STORE_MANAGER') && (
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Assigned Store *</Label>
                  <Select value={form.store_id} onValueChange={v => setForm({...form, store_id: v})}>
                    <SelectTrigger className="rounded-sm" data-testid="user-store-select"><SelectValue placeholder="Select store" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              {/* Service Access Selection - only for Admin, HO Staff, CRM Staff, Director */}
              {form.role && !['STORE_STAFF', 'STORE_MANAGER'].includes(form.role) && (
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

              {['STORE_STAFF', 'STORE_MANAGER'].includes(form.role) && (
                <p className="text-[11px] font-body text-slate-500 bg-slate-50 p-3 rounded-sm">{form.role === 'STORE_MANAGER' ? 'Store Manager' : 'Store Staff'} gets access to all store-related modules for their assigned store automatically.</p>
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
                {['Name', 'Email', 'Role', 'Services', 'Status', 'Actions'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-16">
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
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] text-sky-600 border-sky-200 hover:bg-sky-50" onClick={() => { if (window.confirm(`Switch to "${u.full_name}"? You can switch back anytime.`)) switchToUser(u.id); }} data-testid={`switch-user-${u.id}`}><LogIn className="w-3 h-3 mr-0.5" />Switch</Button>
                      <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px]" onClick={() => openEditUser(u)} data-testid={`edit-user-${u.id}`}><Edit3 className="w-3 h-3 mr-0.5" />Edit</Button>
                      {u.is_active ? (
                        <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] text-red-600 hover:bg-red-50" onClick={() => handleToggleActive(u)} data-testid={`disable-user-${u.id}`}><ShieldOff className="w-3 h-3 mr-0.5" />Disable</Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] text-emerald-600 hover:bg-emerald-50" onClick={() => handleToggleActive(u)} data-testid={`enable-user-${u.id}`}><ShieldCheck className="w-3 h-3 mr-0.5" />Enable</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={v => { if (!v) setEditUser(null); }}>
        <DialogContent className="rounded-sm max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Edit User: {editUser?.email}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label className="font-body text-xs">Full Name</Label><Input value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})} className="rounded-sm" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="font-body text-xs">Role</Label>
                <Select value={editForm.role} onValueChange={v => setEditForm({...editForm, role: v})}><SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ADMIN">Admin</SelectItem><SelectItem value="HO_STAFF">HO Staff</SelectItem><SelectItem value="STORE_MANAGER">Store Manager</SelectItem><SelectItem value="STORE_STAFF">Store Staff</SelectItem><SelectItem value="CRM_STAFF">CRM Staff</SelectItem><SelectItem value="DIRECTOR">Director</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label className="font-body text-xs">Store</Label>
                <Select value={editForm.store_id || 'none'} onValueChange={v => setEditForm({...editForm, store_id: v === 'none' ? '' : v})}><SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-1.5"><Label className="font-body text-xs">New Password (leave blank to keep)</Label><Input type="password" value={editForm.password} onChange={e => setEditForm({...editForm, password: e.target.value})} className="rounded-sm" placeholder="Optional" /></div>
            <div className="flex items-center gap-2"><Checkbox checked={editForm.is_active} onCheckedChange={v => setEditForm({...editForm, is_active: v})} /><Label className="font-body text-xs">Active</Label></div>
          </div>
          <DialogFooter><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={handleEditUser} disabled={saving}>{saving ? 'Saving...' : 'Update User'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
