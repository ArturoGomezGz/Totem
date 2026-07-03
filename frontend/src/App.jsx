import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Units from './pages/Units'
import NewUnitPage from './pages/NewUnitPage'
import UnitDetail from './pages/UnitDetail'
import Profiles from './pages/Profiles'
import ProfileFormPage from './pages/ProfileFormPage'
import Firmware from './pages/Firmware'
import SettingsPage from './pages/SettingsPage'
import Organizations from './pages/Organizations'
import NewOrganizationPage from './pages/NewOrganizationPage'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/units"                    element={<Units />} />
          <Route path="/units/new"                element={<NewUnitPage />} />
          <Route path="/units/:unitId"            element={<UnitDetail />} />
          <Route path="/profiles"                 element={<Profiles />} />
          <Route path="/profiles/new"             element={<ProfileFormPage />} />
          <Route path="/profiles/:profileId/edit" element={<ProfileFormPage />} />
          <Route path="/firmware"                 element={<Firmware />} />
          <Route path="/settings"                 element={<SettingsPage />} />
          <Route path="/organizations"            element={<Organizations />} />
          <Route path="/organizations/new"        element={<NewOrganizationPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/units" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
