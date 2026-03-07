import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { ShoppingCart, Search, Trash2, Plus, Package, MessageCircle, Send } from 'lucide-react';

export default function StoreRequestPage() {
  const { user } = useAuth();
  const isHO = user?.role === 'ADMIN' || user?.role === 'HO_STAFF';
  const isCRM = user?.role === 'CRM_STAFF';
  const isStore = user?.role === 'STORE_STAFF';
  const canApprove = isHO || isCRM;
  const canManage = isHO;
  const [stores, setStores] = useState([]);
  const [requests, setRequests] = useState([]);
  // New request form
  const [reason, setReason] = useState('');
  const [storeId, setStoreId] = useState('');
  const [custName, setCustName] = useState('');
  const [custMobile, setCustMobile] = useState('');
  const [items, setItems] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [manualCost, setManualCost] = useState('');
  const [hasPrescription, setHasPrescription] = useState(false);
  const [doctorName, setDoctorName] = useState('');
  const [clinicLocation, setClinicLocation] = useState('');
  const [saving, setSaving] = useState(false);
  // Chat
  const [chatOpen, setChatOpen] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatMsg, setChatMsg] = useState('');
  const [allComments, setAllComments] = useState([]);
  const [msgSearch, setMsgSearch] = useState('');
  const [viewedMsgs, setViewedMsgs] = useState(() => { try { return JSON.parse(localStorage.getItem('viewed_msgs') || '[]'); } catch { return []; } });
  const [reqSearch, setReqSearch] = useState('');
  // HO review
  const [allItems, setAllItems] = useState([]);
  const [reviewFilter, setReviewFilter] = useState('all');
  const sugRef = useRef(null);

  useEffect(() => { api.get('/stores').then(r => setStores(r.data.stores)).catch(() => {}); loadData(); }, []);
  useEffect(() => { if (user?.role === 'STORE_STAFF' && user?.store_id) setStoreId(String(user.store_id)); }, [user]);

  const loadData = () => {
    api.get('/po/store-requests').then(r => setRequests(r.data.requests)).catch(() => {});
    api.get('/po/purchase-review?po_category=all').then(r => setAllItems(r.data.items)).catch(() => {});
    api.get('/po/all-comments', { params: { limit: 50, search: msgSearch || undefined } }).then(r => setAllComments(r.data.comments)).catch(() => {});
  };
  useEffect(() => { loadData(); }, []);
  useEffect(() => { api.get('/po/all-comments', { params: { limit: 50, search: msgSearch || undefined } }).then(r => setAllComments(r.data.comments)).catch(() => {}); }, [msgSearch]);

  useEffect(() => {
    if (productSearch.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => { api.get('/products', { params: { search: productSearch, limit: 15 } }).then(r => { setSuggestions(r.data.products); setShowSugg(true); }).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);
  useEffect(() => { const h = (e) => { if (sugRef.current && !sugRef.current.contains(e.target)) setShowSugg(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  const addProduct = (p) => {
    if (items.find(i => i.product_id === p.product_id)) { toast.warning('Already added'); return; }
    api.get('/po/product-stock-info', { params: { product_id: p.product_id } }).then(r => {
      const info = r.data.products?.[0];
      setItems(prev => [...prev, { product_id: p.product_id, product_name: p.product_name, is_registered: true,
        landing_cost: info?.landing_cost || p.landing_cost || 0, quantity: 1, store_stock: info?.store_stock || [], has_prescription: false }]);
    }).catch(() => { setItems(prev => [...prev, { product_id: p.product_id, product_name: p.product_name, is_registered: true, landing_cost: p.landing_cost || 0, quantity: 1, store_stock: [], has_prescription: false }]); });
    setProductSearch(''); setShowSugg(false);
  };
  const addManualProduct = () => {
    if (!manualName) return;
    setItems([...items, { product_id: null, product_name: manualName, is_registered: false, landing_cost: parseFloat(manualCost) || 0, quantity: parseFloat(manualQty) || 1, store_stock: [],
      has_prescription: hasPrescription, doctor_name: hasPrescription ? doctorName : null, clinic_location: hasPrescription ? clinicLocation : null }]);
    setManualName(''); setManualQty(''); setManualCost(''); setHasPrescription(false); setDoctorName(''); setClinicLocation('');
  };
  const updateQty = (idx, qty) => { const n = [...items]; n[idx].quantity = parseFloat(qty) || 0; setItems(n); };
  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx));
  const totalValue = items.reduce((s, i) => s + (i.quantity * i.landing_cost), 0);
  const needsCustomer = reason === 'emergency_purchase' || reason === 'customer_enquiry';

  const handleSubmit = async () => {
    if (!storeId || !reason || items.length === 0) { toast.error('Fill all required fields'); return; }
    if (needsCustomer && (!custName || !custMobile)) { toast.error('Customer details required'); return; }
    setSaving(true);
    try {
      await api.post('/po/store-request', {
        store_id: parseInt(storeId), request_reason: reason,
        customer_name: needsCustomer ? custName : null, customer_mobile: needsCustomer ? custMobile : null,
        items: items.map(i => ({ product_id: i.product_id, product_name: i.product_name, is_registered: i.is_registered,
          quantity: i.quantity, has_prescription: i.has_prescription || false,
          doctor_name: i.doctor_name || null, clinic_location: i.clinic_location || null })),
      });
      toast.success('Request submitted!');
      setReason(''); setCustName(''); setCustMobile(''); setItems([]);
      loadData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const updateItem = async (id, updates) => {
    try { await api.put('/po/purchase-review/update', { item_ids: [id], ...updates }); loadData(); } catch { toast.error('Failed'); }
  };

  const openChat = async (itemId) => {
    setChatOpen(itemId);
    setChatMsg('');
    try { const r = await api.get(`/po/request-comments/${itemId}`); setChatMessages(r.data.comments); } catch { setChatMessages([]); }
  };
  const sendChat = async () => {
    if (!chatMsg.trim() || !chatOpen) return;
    try { await api.post('/po/request-comment', { item_id: chatOpen, message: chatMsg }); setChatMsg('');
      const r = await api.get(`/po/request-comments/${chatOpen}`); setChatMessages(r.data.comments);
      api.get('/po/all-comments?limit=50').then(r => setAllComments(r.data.comments)).catch(() => {});
    } catch { toast.error('Failed'); }
  };

  const markViewed = (msgId) => {
    const updated = [...new Set([...viewedMsgs, msgId])];
    setViewedMsgs(updated);
    localStorage.setItem('viewed_msgs', JSON.stringify(updated));
  };
  const openChatFromMsg = (msg) => {
    markViewed(msg.id);
    openChat(msg.item_id);
  };
  const unreadCount = allComments.filter(c => !viewedMsgs.includes(c.id)).length;

  const reasonBadge = (r) => r === 'emergency_purchase' ? 'bg-red-50 text-red-700' : r === 'stock_refill' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700';
  const sBadge = (s) => ({ approved: 'bg-emerald-50 text-emerald-700', ordered: 'bg-sky-50 text-sky-700', rejected: 'bg-red-50 text-red-700', cancelled: 'bg-slate-200 text-slate-600', order_placed: 'bg-amber-50 text-amber-700' }[s] || 'bg-amber-50 text-amber-700');

  let filteredItems = reviewFilter === 'all' ? allItems : allItems.filter(i =>
    i.item_status === reviewFilter || i.fulfillment_status === reviewFilter
  );
  if (reqSearch) {
    const sl = reqSearch.toLowerCase();
    filteredItems = filteredItems.filter(i =>
      i.product_name?.toLowerCase().includes(sl) || String(i.request_id).includes(sl) || i.store_name?.toLowerCase().includes(sl) || i.product_id?.includes(sl)
    );
  }
  // Non-categorized items (no po_category) for normal requests view
  const normalRequests = requests;

  return (
    <div data-testid="store-request-page" className="space-y-5">
      <div><h2 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">Store Requests</h2>
        <p className="text-sm font-body text-slate-500 mt-0.5">{isHO ? 'Review and manage all store requests' : 'Request products from Head Office'}</p></div>

      <Tabs defaultValue={isHO ? "requests" : "new"}>
        <TabsList className="rounded-sm">
          <TabsTrigger value="new" className="rounded-sm text-xs font-body">New Request</TabsTrigger>
          <TabsTrigger value="requests" className="rounded-sm text-xs font-body">Requests ({allItems.length})</TabsTrigger>
          <TabsTrigger value="messages" className="rounded-sm text-xs font-body">
            Messages {unreadCount > 0 && <Badge className="ml-1 text-[8px] rounded-full bg-red-500 text-white px-1.5 animate-pulse">{unreadCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* Requests - Individual Products */}
        <TabsContent value="requests">
          <div className="flex gap-3 mb-3 items-center">
            <div className="flex gap-1.5 flex-wrap">
              {['all', 'pending', 'approved', 'rejected', 'cancelled', 'order_placed'].map(s => (
                <Button key={s} variant={reviewFilter === s ? 'default' : 'outline'} size="sm"
                  className={`rounded-sm font-body text-xs capitalize ${reviewFilter === s ? 'bg-sky-500 hover:bg-sky-600' : ''}`}
                  onClick={() => setReviewFilter(s)}>{s.replace('_', ' ')}</Button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[200px] ml-auto"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input placeholder="Search by request ID, store, product..." value={reqSearch} onChange={e => setReqSearch(e.target.value)}
                className="pl-9 h-8 text-[11px] rounded-sm" /></div>
          </div>
          <div className="space-y-3">
            {filteredItems.length === 0 ? (
              <Card className="border-slate-200 rounded-sm"><CardContent className="p-12 text-center"><ShoppingCart className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No requests</p></CardContent></Card>
            ) : filteredItems.map(it => (
              <Card key={it.id} className={`border-slate-200 shadow-sm rounded-sm overflow-hidden ${
                it.item_status === 'approved' ? 'border-l-4 border-l-emerald-500' :
                it.item_status === 'order_placed' ? 'border-l-4 border-l-sky-500' :
                it.item_status === 'rejected' ? 'border-l-4 border-l-red-500' :
                it.item_status === 'cancelled' ? 'border-l-4 border-l-slate-400' :
                'border-l-4 border-l-amber-400'}`}>
                <CardContent className="p-0">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge className="text-[9px] rounded-sm bg-slate-200 text-slate-700 font-mono shrink-0">REQ-{it.request_id}</Badge>
                      <span className="text-[14px] font-heading font-bold text-slate-900 truncate">{it.product_name}</span>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">{it.product_id}</span>
                      {it.product_info?.sub_category && <Badge variant="secondary" className="text-[8px] rounded-sm shrink-0">{it.product_info.sub_category}</Badge>}
                    </div>
                    <Badge className={`text-[10px] rounded-sm px-2 font-medium ${sBadge(it.item_status)}`}>{it.item_status?.replace('_',' ').toUpperCase()}</Badge>
                  </div>
                  {/* Info Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b border-slate-100">
                    {[{l:'Store',v:it.store_name},{l:'Qty',v:it.quantity},{l:'L.Cost',v:`INR ${(it.landing_cost||0).toFixed(2)}`},{l:'Value',v:`INR ${(it.quantity*(it.landing_cost||0)).toFixed(2)}`}].map(d => (
                      <div key={d.l} className="px-4 py-2 border-r border-slate-100 last:border-r-0">
                        <p className="text-[9px] font-body text-slate-400 uppercase">{d.l}</p>
                        <p className="text-[13px] font-heading font-semibold text-slate-800">{d.v}</p>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2.5 space-y-2">
                    {/* Details */}
                    <div className="flex gap-3 text-[11px] font-body text-slate-500 flex-wrap">
                      <span>Sales 30d: <b className="text-slate-700">{it.sales_30d||0}</b></span>
                      <span>Reason: <Badge className={`text-[8px] rounded-sm ${reasonBadge(it.request_reason)}`}>{it.request_reason?.replace('_',' ')}</Badge></span>
                      {it.customer_name && <span>Customer: <b className="text-slate-700">{it.customer_name}</b> ({it.customer_mobile})</span>}
                      {it.tat_type && <span>TAT: <b className="text-sky-700">{it.tat_type==='same_day'?'Same Day':it.tat_type==='next_day'?'Next Day':`${it.tat_days}d`}</b></span>}
                    </div>
                    {/* Stock */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-400 font-medium">STOCK:</span>
                      {it.store_stock?.length > 0 ? it.store_stock.map((s,j) => <Badge key={j} className="text-[9px] rounded-sm bg-sky-50 text-sky-700 px-1.5">{s.store}: {s.stock}</Badge>) : <Badge className="text-[9px] rounded-sm bg-red-50 text-red-600">No stock</Badge>}
                    </div>
                    {/* Suppliers (read-only list) */}
                    {Object.values(it.suppliers||{}).some(Boolean) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-slate-400 font-medium">SUPPLIERS:</span>
                        {Object.entries(it.suppliers||{}).map(([type,name]) => name && (
                          <Badge key={type} variant="secondary" className="text-[9px] rounded-sm">{name} ({type})</Badge>
                        ))}
                      </div>
                    )}
                    {/* Communication */}
                    {it.ho_remarks && <p className="text-[10px] font-body text-violet-600 bg-violet-50/50 px-2 py-1 rounded-sm">{it.ho_remarks}</p>}
                    {/* Chat Button */}
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className={`h-7 px-3 rounded-sm text-[10px] ${chatOpen === it.id ? 'bg-sky-50 border-sky-300' : ''}`}
                        onClick={() => chatOpen === it.id ? setChatOpen(null) : openChat(it.id)}>
                        <MessageCircle className="w-3 h-3 mr-1" /> Chat
                      </Button>
                    </div>
                    {/* Chat Panel */}
                    {chatOpen === it.id && (
                      <div className="bg-slate-50 rounded-sm border border-slate-200 overflow-hidden">
                        <div className="max-h-[200px] overflow-auto p-2 space-y-1.5">
                          {chatMessages.length === 0 && <p className="text-[10px] text-slate-400 text-center py-4">No messages yet</p>}
                          {chatMessages.map(m => {
                            const isMe = m.user_name === user?.full_name;
                            return (
                              <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] rounded-lg px-3 py-1.5 ${isMe ? 'bg-sky-500 text-white' : 'bg-white border border-slate-200'}`}>
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-[9px] font-medium ${isMe ? 'text-sky-100' : 'text-sky-700'}`}>{m.user_name}</span>
                                    <Badge className={`text-[7px] rounded-sm px-1 ${isMe ? 'bg-sky-400 text-white' : 'bg-slate-100 text-slate-500'}`}>{m.user_role?.replace('_',' ')}</Badge>
                                  </div>
                                  <p className={`text-[11px] ${isMe ? 'text-white' : 'text-slate-700'}`}>{m.message}</p>
                                  <p className={`text-[8px] mt-0.5 ${isMe ? 'text-sky-200' : 'text-slate-400'}`}>{m.created_at ? new Date(m.created_at).toLocaleString() : ''}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-1.5 p-2 border-t border-slate-200 bg-white">
                          <Input placeholder="Type message..." value={chatMsg} onChange={e => setChatMsg(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && sendChat()} className="flex-1 h-8 text-[11px] rounded-sm" />
                          <Button size="sm" className="h-8 w-8 p-0 bg-sky-500 hover:bg-sky-600 rounded-sm" onClick={sendChat} disabled={!chatMsg.trim()}>
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {/* Store: Cancel option */}
                    {isStore && it.item_status === 'pending' && (
                      <Button size="sm" variant="outline" className="h-7 px-3 rounded-sm text-[10px] text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => updateItem(it.id, {status:'cancelled'})}>Cancel Request</Button>
                    )}
                    {/* CRM/HO: Approve/Reject */}
                    {canApprove && it.item_status === 'pending' && (
                      <div className="flex items-center gap-2 bg-slate-50 rounded-sm p-2">
                        <Button size="sm" className="h-7 px-4 rounded-sm text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white"
                          onClick={() => updateItem(it.id, {status:'approved'})}>Approve</Button>
                        <Button size="sm" variant="outline" className="h-7 px-4 rounded-sm text-[10px] text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => updateItem(it.id, {status:'rejected'})}>Reject</Button>
                        <div className="flex items-center gap-1.5 ml-auto">
                          <span className="text-[10px] text-slate-500">TAT:</span>
                          {['same_day','next_day'].map(t => (
                            <Button key={t} size="sm" variant="outline" className={`h-6 px-2 rounded-sm text-[9px] ${it.tat_type===t?'bg-sky-500 text-white border-sky-500':''}`}
                              onClick={() => updateItem(it.id, {tat_type:t, tat_days:t==='same_day'?0:1})}>{t==='same_day'?'Same Day':'Next Day'}</Button>
                          ))}
                          <Input type="number" placeholder="days" className="w-[45px] h-6 text-[10px] rounded-sm text-center"
                            defaultValue={it.tat_days>1?it.tat_days:''} onBlur={e=>{const v=parseInt(e.target.value);if(v>1)updateItem(it.id,{tat_type:'days',tat_days:v});}} />
                        </div>
                      </div>
                    )}
                    {/* HO only: Select Supplier + Order Placed (after approval) */}
                    {canManage && it.item_status === 'approved' && (
                      <div className="flex items-center gap-2 bg-amber-50/50 rounded-sm p-2 border border-amber-200">
                        <span className="text-[10px] text-slate-500 font-medium">Supplier:</span>
                        <Select value={it.selected_supplier || ''} onValueChange={v => updateItem(it.id, {supplier: v})}>
                          <SelectTrigger className="w-[200px] h-7 text-[10px] rounded-sm"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(it.suppliers||{}).map(([type,name]) => name && (
                              <SelectItem key={type} value={name}>{name} ({type})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {it.selected_supplier && <Badge className="text-[9px] rounded-sm bg-emerald-100 text-emerald-700">{it.selected_supplier}</Badge>}
                        <Button size="sm" className="h-7 px-4 rounded-sm text-[10px] bg-amber-500 hover:bg-amber-600 text-white ml-auto"
                          disabled={!it.selected_supplier}
                          onClick={() => updateItem(it.id, {fulfillment_status:'order_placed', status:'order_placed'})}>Mark Order Placed</Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>


        {/* Messages Panel */}
        <TabsContent value="messages">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardHeader className="pb-2 border-b border-slate-100">
              <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-sky-500" /> All Communications ({allComments.length})
                {unreadCount > 0 && <Badge className="text-[9px] rounded-full bg-red-500 text-white px-2">{unreadCount} new</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[calc(100vh-280px)] overflow-auto">
                {allComments.length === 0 ? (
                  <div className="text-center py-16"><MessageCircle className="w-10 h-10 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-body">No messages</p></div>
                ) : allComments.map(m => {
                  const isMe = m.user_name === user?.full_name;
                  const isUnread = !viewedMsgs.includes(m.id);
                  return (
                    <div key={m.id}
                      className={`flex gap-3 px-4 py-3 border-b border-slate-50 cursor-pointer transition-colors ${isUnread ? 'bg-sky-50/60 hover:bg-sky-100/60' : 'hover:bg-slate-50/50'}`}
                      onClick={() => openChatFromMsg(m)}>
                      {isUnread && <div className="w-2 h-2 rounded-full bg-sky-500 shrink-0 mt-3" />}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold ${
                        m.user_role === 'STORE_STAFF' ? 'bg-emerald-100 text-emerald-700' :
                        m.user_role === 'CRM_STAFF' ? 'bg-rose-100 text-rose-700' :
                        m.user_role === 'HO_STAFF' ? 'bg-sky-100 text-sky-700' :
                        'bg-violet-100 text-violet-700'}`}>
                        {m.user_name?.[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[12px] font-body ${isUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{m.user_name}</span>
                          <Badge className={`text-[7px] rounded-sm px-1 ${
                            m.user_role === 'STORE_STAFF' ? 'bg-emerald-50 text-emerald-600' :
                            m.user_role === 'CRM_STAFF' ? 'bg-rose-50 text-rose-600' :
                            m.user_role === 'HO_STAFF' ? 'bg-sky-50 text-sky-600' :
                            'bg-violet-50 text-violet-600'}`}>{m.user_role?.replace('_',' ')}</Badge>
                          <Badge className="text-[8px] rounded-sm bg-slate-200 text-slate-700 font-mono">REQ-{m.request_id}</Badge>
                          <Badge variant="secondary" className="text-[8px] rounded-sm">{m.store_name}</Badge>
                          <span className="text-[9px] text-slate-400">{m.created_at ? new Date(m.created_at).toLocaleString() : ''}</span>
                        </div>
                        <Badge variant="secondary" className="text-[8px] rounded-sm px-1 mt-0.5">{m.product_name?.slice(0,40)}</Badge>
                        <p className={`text-[12px] font-body mt-1 ${isUnread ? 'text-slate-900' : 'text-slate-600'}`}>{m.message}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* New Request Form */}
        <TabsContent value="new">
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="font-body text-xs font-medium">1. Reason *</Label>
                  <Select value={reason} onValueChange={setReason}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent><SelectItem value="emergency_purchase">Emergency Purchase</SelectItem><SelectItem value="stock_refill">Stock Refill</SelectItem><SelectItem value="customer_enquiry">Customer Enquiry</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label className="font-body text-xs">Store *</Label>
                  <Select value={storeId} onValueChange={setStoreId} disabled={user?.role==='STORE_STAFF'}><SelectTrigger className="rounded-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{stores.map(s=><SelectItem key={s.id} value={String(s.id)}>{s.store_name}</SelectItem>)}</SelectContent></Select></div>
              </div>
              {reason && needsCustomer && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-amber-50/50 border border-amber-200 rounded-sm">
                  <div className="space-y-1.5"><Label className="font-body text-xs">Customer *</Label><Input value={custName} onChange={e=>setCustName(e.target.value)} className="rounded-sm" /></div>
                  <div className="space-y-1.5"><Label className="font-body text-xs">Mobile *</Label><Input value={custMobile} onChange={e=>setCustMobile(e.target.value)} className="rounded-sm font-mono" maxLength={10} /></div>
                </div>
              )}
              {reason && (<>
                <div className="space-y-1.5" ref={sugRef}><Label className="font-body text-xs font-medium">2. Add Products</Label>
                  <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <Input placeholder="Search product..." value={productSearch} onChange={e=>setProductSearch(e.target.value)} onFocus={()=>suggestions.length>0&&setShowSugg(true)} className="rounded-sm pl-9" autoComplete="off" />
                    {showSugg && suggestions.length>0 && (<div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-[200px] overflow-auto">
                      {suggestions.map(p=>(<button key={p.product_id} type="button" className="w-full text-left px-3 py-2 hover:bg-sky-50 border-b border-slate-50" onClick={()=>addProduct(p)}>
                        <p className="text-[13px] font-medium">{p.product_name}</p><p className="text-[10px] text-slate-400">{p.product_id} | L.Cost: {p.landing_cost}</p></button>))}</div>)}</div></div>
                <div className="flex gap-2 items-end">
                  <Input placeholder="Non-reg product" value={manualName} onChange={e=>setManualName(e.target.value)} className="flex-1 rounded-sm text-sm" />
                  <Input placeholder="Qty" type="number" value={manualQty} onChange={e=>setManualQty(e.target.value)} className="w-[60px] rounded-sm text-sm" />
                  <Input placeholder="Cost" type="number" value={manualCost} onChange={e=>setManualCost(e.target.value)} className="w-[70px] rounded-sm text-sm" />
                  <Button variant="outline" size="sm" className="rounded-sm text-xs" onClick={addManualProduct} disabled={!manualName}><Plus className="w-3 h-3" /></Button>
                </div>
              </>)}
              {items.length>0 && (<>
                <Card className="border-emerald-200 rounded-sm"><Table><TableBody>{items.map((it,i)=>(
                  <TableRow key={i}><TableCell className="text-[12px] font-medium py-1.5">{it.product_name}</TableCell>
                    <TableCell className="py-1"><div className="flex gap-0.5 flex-wrap">{it.store_stock?.length>0?it.store_stock.map((s,j)=><Badge key={j} variant="secondary" className="text-[7px] rounded-sm px-1">{s.store}:{s.stock}</Badge>):<span className="text-[9px] text-slate-400">{it.is_registered?'No stock':'-'}</span>}</div></TableCell>
                    <TableCell className="text-right py-1.5"><Input type="number" min={1} value={it.quantity} onChange={e=>updateQty(i,e.target.value)} className="w-[60px] h-7 text-right rounded-sm text-[12px] ml-auto" /></TableCell>
                    <TableCell className="text-right text-[11px] tabular-nums">{it.landing_cost.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums font-medium">INR {(it.quantity*it.landing_cost).toFixed(2)}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={()=>removeItem(i)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                  </TableRow>))}</TableBody></Table>
                  <div className="flex justify-between items-center px-4 py-2 bg-emerald-50 border-t border-emerald-100">
                    <span className="text-[12px] text-emerald-800">{items.length} items</span>
                    <span className="text-lg font-heading font-bold text-emerald-700 tabular-nums">INR {totalValue.toFixed(2)}</span>
                  </div></Card>
                <Button className="bg-sky-500 hover:bg-sky-600 rounded-sm font-body text-xs w-full" onClick={handleSubmit} disabled={saving}>
                  {saving?'Submitting...':`Submit (${items.length} items, INR ${totalValue.toFixed(2)})`}</Button>
              </>)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
