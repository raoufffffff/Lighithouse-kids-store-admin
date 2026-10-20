import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import { PageLoader } from './components/ui'
import { isConfigured } from './lib/supabase'
import Delivery from './pages/Delivery'
import Expenses from './pages/Expenses'
import Inventory from './pages/Inventory'
import HomeBuilder from './pages/HomeBuilder'
import Login from './pages/Login'
import OrderDetail from './pages/OrderDetail'
import Orders from './pages/Orders'
import Pixels from './pages/Pixels'
import { AbDetail, AbList } from './pages/AbTests'
import Abandoned from './pages/Abandoned'
import Profit from './pages/Profit'
import ProductOffers from './pages/ProductOffers'
import ProductDesign from './pages/ProductDesign'
import ProductForm from './pages/ProductForm'
import ProductPage from './pages/ProductPage'
import Products from './pages/Products'
import StoreSettings from './pages/StoreSettings'
import Visits from './pages/Visits'

export default function App() {
  const { session, isAdmin, loading } = useAuth()

  if (!isConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-md rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-900">
          <p className="font-bold">إعدادات Supabase غير موجودة</p>
          <p className="mt-2 text-sm" dir="ltr">
            Create a .env file from .env.example (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <PageLoader />
      </div>
    )
  }

  if (!session || !isAdmin) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/orders" replace />} />
        <Route path="home" element={<HomeBuilder />} />
        <Route path="orders" element={<Orders />} />
        <Route path="visits" element={<Visits />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<ProductForm />} />
        <Route path="products/:id" element={<ProductForm />} />
        <Route path="products/:id/page" element={<ProductPage />} />
        <Route path="products/:id/offers" element={<ProductOffers />} />
        <Route path="products/:id/design" element={<ProductDesign />} />
        <Route path="abandoned" element={<Abandoned />} />
        <Route path="profit" element={<Profit />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="ab" element={<AbList />} />
        <Route path="ab/:id" element={<AbDetail />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="pixels" element={<Pixels />} />
        <Route path="settings" element={<StoreSettings />} />
        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Route>
    </Routes>
  )
}
