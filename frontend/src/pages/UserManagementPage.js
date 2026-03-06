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
import { toast } from 'sonner';
import { Users, Plus } from 'lucide-react';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: '', store_id: '' });
  const [saving, setSaving] = useState(false);

  const loadUsers = () => { api.get('/users').then(r => setUsers(r.data.users)).catch(() => {}); };
  useEffect(() => {
    loadUsers();
    api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.store_id) payload.store_id = parseInt(payload.store_id);
      else delete payload.store_id;
      await api.post('/users', payload);
      toast.success('User created');
      setOpen(false);
      setForm({ email: '', password: '', full_name: '', role: '', store_id: '' });
      loadUsers();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const roleColor = (r) => {
    if (r === 'ADMIN') return 'bg-violet-50 text-violet-700';
    if (r === 'HO_STAFF') return 'bg-sky-50 text-sky-700';
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
          <DialogContent className="rounded-sm">
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
                      <SelectItem value="STORE_STAFF">Store Staff</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.role === 'STORE_STAFF' && (
                <div className="space-y-1.5">
                  <Label className="font-body text-xs">Assigned Store</Label>
                  <Select value={form.store_id} onValueChange={v => setForm({...form, store_id: v})}>
                    <SelectTrigger className="rounded-sm" data-testid="user-store-select"><SelectValue placeholder="Select store" /></SelectTrigger>
                    <SelectContent>{stores.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
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
                {['Name', 'Email', 'Role', 'Status'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-400 font-body py-3">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-16">
                  <Users className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-body">No users</p>
                </TableCell></TableRow>
              ) : users.map(u => (
                <TableRow key={u.id} className="hover:bg-slate-50/50" data-testid={`user-row-${u.id}`}>
                  <TableCell className="font-body text-[13px] font-medium text-slate-800">{u.full_name}</TableCell>
                  <TableCell className="text-[12px] font-body text-slate-500">{u.email}</TableCell>
                  <TableCell><Badge className={`text-[10px] rounded-sm ${roleColor(u.role)}`}>{u.role?.replace('_', ' ')}</Badge></TableCell>
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
