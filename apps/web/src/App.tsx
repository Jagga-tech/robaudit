import { Navigate, Route, Routes } from 'react-router-dom';
import { PhoneDrawer } from './components/PhoneDrawer';
import { AuditReplay } from './pages/AuditReplay';
import { CommandCenter } from './pages/CommandCenter';
import { Investigation } from './pages/Investigation';
import { Approvals, Ledger, ManagerPage, Policies, Project } from './pages/secondary';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/exceptions/oakland-forecast" element={<Investigation />} />
        <Route path="/audit" element={<AuditReplay />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/policies" element={<Policies />} />
        <Route path="/projects" element={<Project />} />
        <Route path="/m" element={<ManagerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PhoneDrawer />
    </>
  );
}
