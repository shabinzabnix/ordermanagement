import { useState } from 'react';
import api from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { toast } from 'sonner';
import { CalendarCheck } from 'lucide-react';

export function FollowupButton({ customerId, customerName, currentDate, onDone, size }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(currentDate ? currentDate.split('T')[0] : '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!date) return;
    setSaving(true);
    try {
      await api.put(`/crm/customers/${customerId}/followup`, { followup_date: date, followup_notes: notes });
      toast.success(`Follow-up set for ${new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
      setOpen(false);
      if (onDone) onDone();
    } catch { toast.error('Failed'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <Button size={size || 'sm'} variant="outline" className="h-6 px-2 rounded-sm text-[10px] font-body text-amber-600 border-amber-200 hover:bg-amber-50"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }} data-testid={`followup-btn-${customerId}`}>
        <CalendarCheck className="w-3 h-3 mr-0.5" /> Follow-up
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-sm" onClick={e => e.stopPropagation()}>
          <DialogHeader><DialogTitle className="font-heading text-[15px]">Set Follow-up{customerName ? ` - ${customerName}` : ''}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label className="font-body text-xs">Follow-up Date *</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label className="font-body text-xs">Notes</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} className="rounded-sm" placeholder="Reason for follow-up..." /></div>
          </div>
          <DialogFooter><Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs" onClick={handleSave} disabled={saving || !date}>{saving ? 'Saving...' : 'Set Follow-up'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
