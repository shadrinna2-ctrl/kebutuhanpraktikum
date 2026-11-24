export type UserRole = 'customer' | 'admin' | 'superadmin';

export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  phone: string;
  role: UserRole;
  emailVerified: boolean;
  mfaEnabled: boolean;
  mfaVerified?: boolean;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  lastReauthAt?: string | null;
}

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  purchase_range: string;
  stock: number;
  condition: 'Baik' | 'Sangat Baik' | 'Perlu Perawatan';
  image: string;
  desc: string;
  model: string;
  rating: number;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface Order {
  id: number;
  order_code: string;
  user_id: number;
  customer_name: string;
  customer_phone: string;
  borrow_date: string;
  borrow_days: number;
  total_amount: number;
  price_needs_confirmation: number;
  note: string;
  status: 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled';
  created_at: string;
  items: OrderItem[];
}

export interface AdaptiveChallenge {
  challengeId: string;
  question: string;
  expiresAt: number;
}

export interface ActiveSession {
  id: string;
  idPrefix: string;
  isCurrent: boolean;
  ipAddress: string;
  userAgent: string;
  approxLocation: string;
  mfaVerified: boolean;
  lastActivityAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface LoginHistoryRow {
  id: number;
  success: number;
  failure_reason: string | null;
  ip_address: string;
  user_agent: string;
  approx_location: string;
  suspicious: number;
  created_at: string;
}

export interface MfaDevice {
  id: number;
  label: string;
  verified: number;
  last_used_at: string | null;
  created_at: string;
}

export interface SecurityEventRow {
  id: number;
  event_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  user_id: number | null;
  ip_address: string;
  path: string;
  method: string;
  summary: string;
  payload_preview: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: number;
  actor_user_id: number | null;
  actor_username: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details_json: string;
  ip_address: string;
  created_at: string;
}
