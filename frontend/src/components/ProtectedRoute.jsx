import { Navigate, Outlet } from 'react-router-dom'
import { OrgProvider } from '../contexts/OrgContext'

export default function ProtectedRoute() {
  const token = localStorage.getItem('access_token')
  if (!token) return <Navigate to="/login" replace />
  return (
    <OrgProvider>
      <Outlet />
    </OrgProvider>
  )
}
