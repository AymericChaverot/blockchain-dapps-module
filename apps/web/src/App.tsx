import { Navigate, Route, Routes } from "react-router";

import { Layout } from "@/components/Layout";
import { RequireRole } from "@/components/layout/RequireRole";
import { useAppMode } from "@/config/mode";
import { DemoPage } from "@/pages/DemoPage";
import { HolderPage } from "@/pages/HolderPage";
import { IssuePage, IssuerOverviewPage } from "@/pages/IssuerPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ProvePage } from "@/pages/ProvePage";
import { AdminPage, IssuersPage } from "@/pages/RegistryPage";
import { VerifierPage } from "@/pages/VerifierPage";

export function App() {
  const { isDemo } = useAppMode();
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public: verification without a wallet, issuer directory, shareable worker page. */}
        <Route index element={<VerifierPage />} />
        <Route path="issuers" element={<IssuersPage />} />
        <Route path="holder/:address" element={<HolderPage />} />
        <Route path="prove" element={<ProvePage />} />

        {/* Worker: own credentials. */}
        <Route
          path="wallet"
          element={
            <RequireRole requirement="wallet">
              <HolderPage />
            </RequireRole>
          }
        />

        {/* Training organization. */}
        <Route
          path="issuer"
          element={
            <RequireRole requirement="issuer">
              <IssuerOverviewPage />
            </RequireRole>
          }
        />
        <Route
          path="issuer/new"
          element={
            <RequireRole requirement="issuer">
              <IssuePage />
            </RequireRole>
          }
        />

        {/* Governance. */}
        <Route
          path="admin"
          element={
            <RequireRole requirement="admin">
              <AdminPage />
            </RequireRole>
          }
        />

        <Route path="demo" element={isDemo ? <DemoPage /> : <Navigate to="/" replace />} />

        {/* Former routes. */}
        <Route path="holder" element={<Navigate to="/wallet" replace />} />
        <Route path="registry" element={<Navigate to="/issuers" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
