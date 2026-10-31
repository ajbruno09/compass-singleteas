export type Role = 'owner' | 'manager' | 'store' | 'department' | 'closing' | 'accounts';
export interface Profile { id: string; full_name: string; phone: string | null; email: string | null; role: Role; extra_language: string | null; active: boolean; }
export interface Location { id: number; code: string; name: string; kind: 'store' | 'department'; sort: number; active: boolean; }
export interface Category { id: number; code: string; name: string; sort: number; }
export interface Unit { code: string; name: string; kind: 'weight' | 'volume' | 'count'; decimals: number; }
export interface Item {
  id: number; name: string; local_names: Record<string, string>; category_id: number; unit: string;
  purchase_unit: string | null; purchase_factor: number | null; quick_amounts: number[]; photo_path: string | null;
  count_frequency: 'daily' | 'weekly'; tolerance_pct: number; last_cost: number | null; active: boolean;
}
export interface Vendor {
  id: string; name: string; code: string | null; category: string | null; contact_person: string | null; phone: string | null;
  whatsapp: string | null; email: string | null; address: string | null; gst: string | null; credit_days: number | null;
  bank_name: string | null; bank_account: string | null; ifsc: string | null; upi: string | null; active: boolean; remarks: string | null;
}
export interface BillRow {
  id: string; vendor_id: string; vendor_name: string; bill_number: string | null; order_date: string | null; received_date: string | null;
  amount: number; status: string; paid: number; balance: number; payment_status: string; due_date: string | null;
}
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner', manager: 'Manager', store: 'Store', department: 'Department staff', closing: 'Closing manager', accounts: 'Accounts'
};
export const LANGUAGES: Record<string, string> = {
  hi: 'हिंदी (Hindi)', as: 'অসমীয়া (Assamese)', bn: 'বাংলা (Bengali)', kn: 'ಕನ್ನಡ (Kannada)', ta: 'தமிழ் (Tamil)',
  ml: 'മലയാളം (Malayalam)', te: 'తెలుగు (Telugu)', ne: 'नेपाली (Nepali)', or: 'ଓଡ଼ିଆ (Odia)'
};

export interface Group { id: number; code: string; name: string; icon: string | null; sort: number; }
export interface DeptItem {
  id: number; name: string; local_names: Record<string, string> | null; group_id: number | null; unit: string;
  pack_note: string | null; quick_amounts: number[] | null; photo_path: string | null;
}
export interface IndentRec { id: string; location_id: number; for_date: string; status: 'draft' | 'submitted' | 'locked' | 'cancelled'; submitted_at: string | null; nothing_needed: boolean; }
export interface Usual { item_id: number; usual: number; last_qty: number; runs: number; }
export interface SosAlert {
  id: string; location_id: number; raised_by: string; item_id: number | null; note: string; created_at: string;
  acked_by: string | null; acked_at: string | null; eta_minutes: number | null; resolved_at: string | null;
}
export interface Contact { full_name: string; phone: string; role: Role; }
export const REASONS = ['Guests or event', 'Running low', 'Spoiled or wasted', 'New dish', 'Other'];
export const SOS_AFTER_SECONDS = 120;
