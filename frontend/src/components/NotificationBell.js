import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { Bell } from 'lucide-react';
import { Badge } from './ui/badge';

export default function NotificationBell() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = () => {
    api.get('/notifications?limit=15').then(r => {
      setNotifications(r.data.notifications || []);
      setUnread(r.data.unread_count || 0);
    }).catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markRead = async (n) => {
    if (!n.is_read) {
      await api.put(`/notifications/${n.id}/read`).catch(() => {});
      setUnread(prev => Math.max(0, prev - 1));
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    }
    if (n.link) { navigate(n.link); setOpen(false); }
  };

  const markAllRead = async () => {
    await api.put('/notifications/read-all').catch(() => {});
    setUnread(0);
    setNotifications(prev => prev.map(x => ({ ...x, is_read: true })));
  };

  const timeAgo = (d) => {
    if (!d) return '';
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen(!open); if (!open) load(); }} className="relative p-2 rounded-sm hover:bg-slate-100 transition-colors" data-testid="notification-bell">
        <Bell className="w-5 h-5 text-slate-600" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] bg-white border border-slate-200 rounded-sm shadow-xl z-50 max-h-[70vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-[13px] font-heading font-semibold text-slate-800">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-[10px] font-body text-sky-600 hover:text-sky-700 font-medium">Mark all read</button>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {notifications.length === 0 ? (
              <div className="p-6 text-center"><Bell className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-[12px] text-slate-400 font-body">No notifications</p></div>
            ) : notifications.map(n => (
              <button key={n.id} className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${!n.is_read ? 'bg-sky-50/40' : ''}`} onClick={() => markRead(n)}>
                <div className="flex items-start gap-2">
                  {!n.is_read && <span className="w-2 h-2 bg-sky-500 rounded-full mt-1.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] font-body ${!n.is_read ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{n.title}</p>
                    <p className="text-[11px] font-body text-slate-400 mt-0.5 truncate">{n.message}</p>
                  </div>
                  <span className="text-[9px] text-slate-300 shrink-0 mt-0.5">{timeAgo(n.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
