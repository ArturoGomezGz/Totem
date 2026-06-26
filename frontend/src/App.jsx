import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Organizations from './pages/Organizations'
import Units from './pages/Units'
import UnitDetail from './pages/UnitDetail'
import Profiles from './pages/Profiles'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/organizations"                              element={<Organizations />} />
          <Route path="/organizations/:orgId/units"                element={<Units />} />
          <Route path="/organizations/:orgId/units/:unitId"        element={<UnitDetail />} />
          <Route path="/organizations/:orgId/profiles"             element={<Profiles />} />
        </Route>

        <Route path="*" element={<Navigate to="/organizations" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
