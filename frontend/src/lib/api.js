import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 30000,
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('pharmacy_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('pharmacy_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Simple client-side cache for GET requests
const _clientCache = {};
const CACHE_TTL = 60000; // 60 seconds

export const cachedGet = async (url, params = {}) => {
  const key = url + JSON.stringify(params);
  const cached = _clientCache[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const res = await api.get(url, { params });
  _clientCache[key] = { data: res, ts: Date.now() };
  return res;
};

export const downloadExcel = async (endpoint, filename) => {
  const response = await api.get(endpoint, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export default api;
