import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Category, Unit } from './types';

export function useMasters() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  useEffect(() => {
    supabase.from('categories').select('*').order('sort').then(({ data }) => setCategories((data as Category[]) ?? []));
    supabase.from('units').select('*').order('code').then(({ data }) => setUnits((data as Unit[]) ?? []));
  }, []);
  return { categories, units };
}

export const DEFAULT_QUICK: Record<string, number[]> = {
  kg: [0.05, 0.1, 0.25, 0.5, 1], L: [0.25, 0.5, 1, 2], pkt: [1, 2, 5], pcs: [1, 5, 10]
};

export async function photoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from('item-photos').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
