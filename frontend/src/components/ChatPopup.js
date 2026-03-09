import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { MessageCircle, Send } from 'lucide-react';
import { toast } from 'sonner';

export function ChatButton({ entityType, entityId, label, details }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="h-6 px-2 rounded-sm text-[10px] font-body" onClick={() => setOpen(true)} data-testid={`chat-${entityType}-${entityId}`}>
        <MessageCircle className="w-3 h-3 mr-0.5" /> {label || 'Chat'}
      </Button>
      <ChatDialog open={open} onClose={() => setOpen(false)} entityType={entityType} entityId={entityId} details={details} />
    </>
  );
}

export function ChatDialog({ open, onClose, entityType, entityId, details }) {
  const [comments, setComments] = useState([]);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open || !entityId) return;
    api.get(`/comments/${entityType}/${entityId}`).then(r => setComments(r.data.comments || [])).catch(() => {});
  }, [open, entityType, entityId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [comments]);

  const send = async () => {
    if (!msg.trim()) return;
    setSending(true);
    try {
      await api.post('/comments', { entity_type: entityType, entity_id: entityId, message: msg.trim() });
      setMsg('');
      const r = await api.get(`/comments/${entityType}/${entityId}`);
      setComments(r.data.comments || []);
    } catch { toast.error('Failed'); }
    finally { setSending(false); }
  };

  const roleColor = (r) => {
    if (r === 'ADMIN') return 'bg-violet-100 text-violet-700';
    if (r === 'HO_STAFF' || r === 'DIRECTOR') return 'bg-sky-100 text-sky-700';
    if (r === 'STORE_MANAGER') return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="rounded-sm max-w-lg p-0 max-h-[80vh] flex flex-col">
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-slate-100 shrink-0">
          <DialogTitle className="font-heading text-[15px]">Communication</DialogTitle>
        </DialogHeader>

        {/* Transaction Details */}
        {details && (
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 shrink-0">
            {details.map((d, i) => (
              <div key={i} className="flex justify-between text-[11px] font-body py-0.5">
                <span className="text-slate-400">{d.label}</span>
                <span className="font-medium text-slate-700">{d.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3 space-y-2 min-h-[200px] max-h-[400px]">
          {comments.length === 0 ? (
            <div className="text-center py-8"><MessageCircle className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400">No messages yet</p></div>
          ) : comments.map(c => (
            <div key={c.id} className="flex gap-2">
              <div className="w-7 h-7 bg-sky-100 rounded-full flex items-center justify-center shrink-0">
                <span className="text-[9px] font-bold text-sky-700">{c.user_name?.[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-body font-medium text-slate-800">{c.user_name}</span>
                  <Badge className={`text-[7px] rounded-sm px-1 ${roleColor(c.user_role)}`}>{c.user_role?.replace('_', ' ')}</Badge>
                  <span className="text-[9px] text-slate-300 ml-auto">{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span>
                </div>
                <p className="text-[12px] font-body text-slate-600 mt-0.5">{c.message}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-slate-100 shrink-0 flex gap-2">
          <Input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Type a message..."
            className="rounded-sm text-sm flex-1" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <Button size="sm" className="bg-sky-500 hover:bg-sky-600 rounded-sm h-9 px-3" onClick={send} disabled={sending || !msg.trim()}>
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
