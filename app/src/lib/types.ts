export type Role = 'owner' | 'manager' | 'store' | 'department' | 'closing' | 'accounts';
export interface Profile { id: string; full_name: string; phone: string | null; email: string | null; role: Role; extra_language: string | null; active: boolean; photo?: string | null; setup_done_at?: string | null; }
export interface Location { id: number; code: string; name: string; kind: 'store' | 'department'; sort: number; active: boolean; }
export interface Category { id: number; code: string; name: string; sort: number; }
export interface Unit { code: string; name: string; kind: 'weight' | 'volume' | 'count'; decimals: number; }
export interface Item {
  id: number; name: string; local_names: Record<string, string>; category_id: number; unit: string;
  purchase_unit: string | null; purchase_factor: number | null; quick_amounts: number[]; photo_path: string | null;
  count_frequency: 'daily' | 'weekly'; tolerance_pct: number; last_cost: number | null; active: boolean;
  base_unit?: string | null; counts_as?: string | null; show_as?: string | null; pack_name?: string | null; pack_size?: number | null;
  pieces_per_pack?: number | null; slices_per_pack?: number | null; weight_per_pack_g?: number | null; wastage_pct?: number | null;
  usable_gas_g?: number | null; receiving_tolerance_g?: number | null; opening_base?: number | null;
}
export interface Vendor {
  id: string; name: string; code: string | null; category: string | null; contact_person: string | null; phone: string | null;
  whatsapp: string | null; email: string | null; address: string | null; gst: string | null; credit_days: number | null;
  bank_name: string | null; bank_account: string | null; ifsc: string | null; upi: string | null; active: boolean; remarks: string | null; qr_path?: string | null;
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
  id: string; location_id: number; raised_by: string; item_id: number | null; item_ids?: number[]; note: string; created_at: string;
  acked_by: string | null; acked_at: string | null; eta_minutes: number | null; resolved_at: string | null;
}
export interface Contact { full_name: string; phone: string; role: Role; }
export const REASONS = ['Guests or event', 'Running low', 'Spoiled or wasted', 'New dish', 'Other'];
export const SOS_AFTER_SECONDS = 120;

export interface MenuItem {
  id: number; name: string; pos_name: string | null; price: number | null; menu_page: string | null; menu_group: string | null;
  location_id: number | null; status: 'active' | 'inactive'; needs_check: boolean; note: string;
}
export interface MenuCombo { id: number; name: string; price: number | null; grp: string | null; parts: string; status: 'active' | 'inactive'; note: string; }
export interface Rule {
  key: string; label: string; description: string; group_name: string; kind: 'number' | 'percent' | 'time' | 'text' | 'money';
  unit: string; value: unknown; wired: boolean; money: boolean; sort: number; why: string; updated_at: string;
}
export interface RuleHist { id: number; key: string; value: unknown; effective_from: string; set_at: string; note: string; }
export interface Notice { id: string; title: string; body: string; location_ids: number[] | null; pinned: boolean; expires_at: string | null; created_at: string; }
export interface AlertRow { id: string; level: 'urgent' | 'today' | 'fyi'; title: string; body: string; created_at: string; location_id: number | null; source: string; }
export interface Signup { id: string; full_name: string; phone: string; location_ids: number[]; selfie: string | null; created_at: string; }
