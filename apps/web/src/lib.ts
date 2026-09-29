import { useEffect, useState } from 'react';
import type { Paginated } from '@inventory/shared';
import { api } from './api';

export interface ItemOption {
  id: string;
  code: string;
  name: string;
  active: boolean;
  unit?: { code: string };
}

/** All items (any status) for pickers. */
export function useItems() {
  const [items, setItems] = useState<ItemOption[]>([]);
  useEffect(() => {
    api
      .get<Paginated<ItemOption>>('/items?pageSize=200&status=all')
      .then((r) => setItems(r.data))
      .catch(() => setItems([]));
  }, []);
  return items;
}

export const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());
export const fmtQty = (s: string) =>
  Number(s).toLocaleString(undefined, { maximumFractionDigits: 3 });
