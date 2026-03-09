import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

export function useSales90d(productNames) {
  const [salesMap, setSalesMap] = useState({});
  const prevRef = useRef('');

  useEffect(() => {
    const names = (productNames || []).filter(Boolean);
    if (!names.length) return;
    const key = names.sort().join('|');
    if (key === prevRef.current) return;
    prevRef.current = key;
    api.post('/products/sales-90d', { product_names: names })
      .then(r => setSalesMap(r.data.sales || {}))
      .catch(() => {});
  }, [productNames]);

  return salesMap;
}

export function Sales90dBadge({ name, salesMap }) {
  const data = salesMap[name];
  if (!data || data.qty === 0) return <span className="text-[10px] text-slate-300 tabular-nums">0</span>;
  return <span className="text-[11px] text-sky-700 font-medium tabular-nums">{data.qty}</span>;
}
