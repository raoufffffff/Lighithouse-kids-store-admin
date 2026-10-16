export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned'

export const ORDER_STATUSES: { value: OrderStatus; label: string; badge: string }[] = [
  { value: 'pending', label: 'قيد الانتظار', badge: 'bg-amber-100 text-amber-800' },
  { value: 'confirmed', label: 'مؤكد', badge: 'bg-sky-100 text-sky-800' },
  { value: 'shipped', label: 'تم الشحن', badge: 'bg-indigo-100 text-indigo-800' },
  { value: 'delivered', label: 'تم التسليم', badge: 'bg-emerald-100 text-emerald-800' },
  { value: 'cancelled', label: 'ملغى', badge: 'bg-rose-100 text-rose-800' },
  { value: 'returned', label: 'مُرجَع', badge: 'bg-slate-200 text-slate-700' },
]

export const statusMeta = (s: string) =>
  ORDER_STATUSES.find((x) => x.value === s) ?? ORDER_STATUSES[0]

export type Category = {
  id: string
  name: string
  slug: string
  is_active: boolean
}

export type Order = {
  id: string
  order_number: number
  customer_name: string
  customer_phone: string
  wilaya_code: number | null
  commune: string | null
  address: string | null
  delivery_type: 'home' | 'desk'
  delivery_fee: number
  subtotal: number
  discount: number
  total: number
  payment_method: string
  status: OrderStatus
  tracking_number: string | null
  notes: string | null
  created_at: string
}

export type OrderItem = {
  id: string
  product_name: string
  variant_label: string | null
  unit_price: number
  quantity: number
  line_total: number
}

export type DeliveryRate = {
  wilaya_code: number
  wilaya_name: string
  home_fee: number
  desk_fee: number
  is_active: boolean
}
