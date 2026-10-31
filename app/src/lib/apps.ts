import type { Role } from './types';

// The apps shown on the "Your apps" screen after sign in. Staff on counters never see it.
export interface AppDef { id: string; name: string; blurb: string; icon: string; roles: Role[]; to?: string; href?: string; status: 'live' | 'soon' | 'separate'; badge?: string }

// Daily Closing still lives on its own address until it is rebuilt inside Compass (Release 4).
export const CLOSING_URL: string = (import.meta.env.VITE_CLOSING_URL as string | undefined) ?? 'https://compass.singleteas.com';

export const APPS: AppDef[] = [
  { id: 'home', name: 'Dashboard', blurb: 'Where things stand today across the business.', icon: 'home', roles: ['owner', 'manager', 'store', 'accounts'], to: '/', status: 'live' },
  { id: 'indents', name: 'Indents', blurb: "Tomorrow's requests from every counter, with SOS alerts.", icon: 'clip', roles: ['owner', 'manager', 'store'], to: '/indents', status: 'live' },
  { id: 'store', name: 'Store and purchases', blurb: 'Receive, issue, and purchase orders sent to vendors.', icon: 'layers', roles: ['owner', 'manager', 'store'], status: 'soon', badge: 'Coming next' },
  { id: 'master', name: 'Items and vendors', blurb: 'The item list, units, photos, and who supplies what.', icon: 'tag', roles: ['owner', 'manager', 'store'], to: '/items', status: 'live' },
  { id: 'bills', name: 'Bills and payments', blurb: 'Vendor bills, what is unpaid, and what needs a check.', icon: 'receipt', roles: ['owner', 'manager', 'accounts'], to: '/bills', status: 'live' },
  { id: 'closing', name: 'Daily closing', blurb: 'End of day cash and POS reconciliation. Opens in its own window.', icon: 'moon', roles: ['owner', 'manager', 'accounts'], href: CLOSING_URL, status: 'separate', badge: 'Separate sign in for now' },
  { id: 'people', name: 'People and access', blurb: 'Who can see which app, and PIN resets.', icon: 'users', roles: ['owner', 'manager'], to: '/people', status: 'live' },
  { id: 'reports', name: 'Reports', blurb: 'Food cost, waste and sales in one place.', icon: 'chart', roles: ['owner', 'manager'], status: 'soon', badge: 'Later' }
];

export const appsFor = (role: Role) => APPS.filter((a) => a.roles.includes(role));
