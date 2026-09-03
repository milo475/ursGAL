import { BrowserRouter, Route, Routes } from 'react-router'
import PermRoute from './components/auth/PermRoute'
import ProtectedRoute from './components/auth/ProtectedRoute'
import RoleRoute from './components/auth/RoleRoute'
import AppShell from './components/layout/AppShell'
import { ToastProvider } from './components/ui/Toast'
import { AuthProvider } from './context/AuthContext'
import { LanguageProvider } from './context/LanguageContext'
import { ThemeProvider } from './context/ThemeContext'
import ActivityLog from './pages/ActivityLog'
import Analytics from './pages/Analytics'
import ChangePassword from './pages/ChangePassword'
import Customers from './pages/Customers'
import Dashboard from './pages/Dashboard'
import Reports from './pages/Reports'
import DeliveryOps from './pages/DeliveryOps'
import Drivers from './pages/Drivers'
import Finance from './pages/Finance'
import FinanceReport from './pages/FinanceReport'
import Login from './pages/Login'
import PublicOrder from './pages/PublicOrder'
import Notifications from './pages/Notifications'
import Payroll from './pages/Payroll'
import MyDeliveries from './pages/MyDeliveries'
import OrderDetail from './pages/OrderDetail'
import OrderNew from './pages/OrderNew'
import OrderRequests from './pages/OrderRequests'
import Orders from './pages/Orders'
import Products from './pages/Products'
import Settings from './pages/Settings'
import Expiry from './pages/Expiry'
import Reorders from './pages/Reorders'
import Stock from './pages/Stock'
import Supplies from './pages/Supplies'
import UserPermissions from './pages/UserPermissions'
import Users from './pages/Users'
import Warehouse from './pages/Warehouse'

function App() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                {/* Login — nav-гүй, хамгаалалтгүй */}
                <Route path="/login" element={<Login />} />
                {/* Нийтийн захиалгын линк — нэвтрэлтгүй (V5) */}
                <Route path="/z/:token" element={<PublicOrder />} />
                {/* Түр нууц үг солих — ProtectedRoute-ийн ГАДНА (V4-06) */}
                <Route path="/change-password" element={<ChangePassword />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<AppShell />}>
                    {/* Бүх эрхэд нээлттэй (dashboard эрхээрээ өөр агуулгатай) */}
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/notifications" element={<Notifications />} />

                    {/*
                     * Staff хуудсууд — effective PERMISSION-ээр (Permission
                     * Panel-аас олгосон/хассан эрх шууд үйлчилнэ; backend
                     * мөн ижил permission-ээ давхар шалгадаг).
                     */}
                    <Route element={<PermRoute perm="orders.view" />}>
                      <Route path="/orders" element={<Orders />} />
                      <Route path="/order-requests" element={<OrderRequests />} />
                      <Route path="/orders/:id" element={<OrderDetail />} />
                    </Route>
                    <Route element={<PermRoute perm="orders.create" />}>
                      <Route path="/orders/new" element={<OrderNew />} />
                    </Route>
                    <Route element={<PermRoute perm="warehouse.handover" />}>
                      <Route path="/warehouse" element={<Warehouse />} />
                    </Route>
                    <Route element={<PermRoute perm="supplies.view" />}>
                      <Route path="/supplies" element={<Supplies />} />
                    </Route>
                    <Route element={<PermRoute perm="inventory.view" />}>
                      <Route path="/products" element={<Products />} />
                      <Route path="/stock" element={<Stock />} />
                      <Route path="/expiry" element={<Expiry />} />
                    </Route>
                    <Route
                      element={
                        <PermRoute
                          anyOf={[
                            'finance.view_income',
                            'finance.view_expense',
                            'finance.view_receivables',
                          ]}
                        />
                      }
                    >
                      <Route path="/finance" element={<Finance />} />
                      <Route
                        path="/finance/report"
                        element={<FinanceReport />}
                      />
                    </Route>
                    <Route
                      element={<PermRoute perm="finance.driver_payroll" />}
                    >
                      <Route path="/finance/payroll" element={<Payroll />} />
                    </Route>
                    <Route element={<PermRoute perm="drivers.view" />}>
                      <Route path="/delivery-ops" element={<DeliveryOps />} />
                      <Route path="/drivers" element={<Drivers />} />
                    </Route>
                    <Route element={<PermRoute perm="analytics.view" />}>
                      <Route path="/analytics" element={<Analytics />} />
                    </Route>
                    <Route
                      element={
                        <PermRoute
                          anyOf={[
                            'reports.delivery',
                            'reports.inventory',
                            'reports.finance',
                          ]}
                        />
                      }
                    >
                      <Route path="/reports" element={<Reports />} />
                    </Route>
                    <Route element={<PermRoute perm="customers.view" />}>
                      <Route path="/customers" element={<Customers />} />
                      <Route path="/reorders" element={<Reorders />} />
                    </Route>
                    <Route element={<PermRoute perm="users.manage" />}>
                      <Route path="/users" element={<Users />} />
                    </Route>
                    <Route
                      element={
                        <PermRoute
                          allOf={['users.manage', 'permissions.manage']}
                        />
                      }
                    >
                      <Route
                        path="/users/:id/permissions"
                        element={<UserPermissions />}
                      />
                    </Route>
                    <Route element={<PermRoute perm="activity_log.view" />}>
                      <Route path="/activity-log" element={<ActivityLog />} />
                    </Route>

                    {/* Хүргэлт — зөвхөн DRIVER */}

                    <Route element={<RoleRoute roles={['DRIVER']} />}>
                      <Route path="/deliveries" element={<MyDeliveries />} />
                    </Route>
                  </Route>
                </Route>
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </LanguageProvider>
  )
}

export default App