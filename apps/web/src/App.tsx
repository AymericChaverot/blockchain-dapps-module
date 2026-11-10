import { Navigate, Route, Routes } from "react-router";

import { Layout } from "@/components/Layout";
import { RequireRole } from "@/components/layout/RequireRole";
import { useAppMode } from "@/config/mode";
import { DemoPage } from "@/pages/DemoPage";
import { HolderPage } from "@/pages/HolderPage";
import { IssuePage, IssuerOverviewPage } from "@/pages/IssuerPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ProvePage } from "@/pages/ProvePage";
import { OrganizationPage } from "@/pages/OrganizationPage";
import { GovernancePage, IssuersPage } from "@/pages/RegistryPage";
import { VerifierPage } from "@/pages/VerifierPage";

export function App() {
  const { isDemo } = useAppMode();
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public: verification without a wallet, organization directory, governance, shareable worker page. */}
        <Route index element={<VerifierPage />} />
        <Route path="issuers" element={<IssuersPage />} />
        <Route path="governance" element={<GovernancePage />} />
        <Route path="organization/:address" element={<OrganizationPage />} />
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

        {/* The connected person's organization (admins and issuing members). */}
        <Route
          path="organization"
          element={
            <RequireRole requirement="affiliated">
              <OrganizationPage />
            </RequireRole>
          }
        />

        <Route path="demo" element={isDemo ? <DemoPage /> : <Navigate to="/" replace />} />

        {/* Former routes. */}
        <Route path="holder" element={<Navigate to="/wallet" replace />} />
        <Route path="registry" element={<Navigate to="/issuers" replace />} />
        <Route path="admin" element={<Navigate to="/governance" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
