import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';

const AuthContext = createContext(null);
const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 1 hour

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('pharmacy_token'));
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState(!!localStorage.getItem('pharmacy_admin_token'));
  const timerRef = useRef(null);

  const resetInactivityTimer = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (localStorage.getItem('pharmacy_token')) {
        localStorage.removeItem('pharmacy_token');
        localStorage.removeItem('pharmacy_admin_token');
        window.location.href = '/login?reason=timeout';
      }
    }, INACTIVITY_TIMEOUT);
  }, []);

  useEffect(() => {
    if (!token) return;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetInactivityTimer));
    resetInactivityTimer();
    return () => { events.forEach(e => window.removeEventListener(e, resetInactivityTimer)); clearTimeout(timerRef.current); };
  }, [token, resetInactivityTimer]);

  useEffect(() => {
    if (token) {
      api.get('/auth/me')
        .then(res => setUser(res.data))
        .catch(() => { logout(); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('pharmacy_token', res.data.token);
    localStorage.removeItem('pharmacy_admin_token');
    setToken(res.data.token);
    setUser(res.data.user);
    setImpersonating(false);
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('pharmacy_token');
    localStorage.removeItem('pharmacy_admin_token');
    setToken(null);
    setUser(null);
    setImpersonating(false);
  };

  const switchToUser = async (userId) => {
    const res = await api.post(`/auth/impersonate/${userId}`);
    localStorage.setItem('pharmacy_admin_token', localStorage.getItem('pharmacy_token'));
    localStorage.setItem('pharmacy_token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    setImpersonating(true);
    const role = res.data.user?.role;
    window.location.href = ['STORE_STAFF', 'STORE_MANAGER'].includes(role) ? '/store-dashboard' : '/dashboard';
  };

  const switchBack = () => {
    const adminToken = localStorage.getItem('pharmacy_admin_token');
    if (!adminToken) return;
    localStorage.setItem('pharmacy_token', adminToken);
    localStorage.removeItem('pharmacy_admin_token');
    setToken(adminToken);
    setImpersonating(false);
    // Reload to refresh user
    window.location.href = '/users';
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, switchToUser, switchBack, impersonating }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
