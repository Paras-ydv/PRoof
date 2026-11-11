import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import { ApiError } from "./api/client";
import { useMe } from "./lib/hooks";
import { AppShell } from "./components/AppShell";
import { Skeleton, ToastProvider } from "./components/Layout";
import { Home, SetupStatus, SignIn } from "./pages/Entry";
import { Landing } from "./pages/Landing";
import { Overview } from "./pages/Overview";
import { Reports } from "./pages/Reports";
import { ReportDetail } from "./pages/ReportDetail";
import { Checks } from "./pages/Checks";
import { Destinations } from "./pages/Destinations";
import { Ai } from "./pages/Ai";
import { Repos } from "./pages/Repos";
import { Audit } from "./pages/Audit";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

/** Pages that need a signed-in user. Unknown users go to sign-in and come back afterwards. */
function RequireUser({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading)
    return (
      <div className="centered">
        <Skeleton width={180} height={14} />
      </div>
    );
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to={`/signin?return_to=${encodeURIComponent(window.location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/setup/requested" element={<SetupStatus kind="requested" />} />
            <Route path="/setup/not-yours" element={<SetupStatus kind="not-yours" />} />
            <Route path="/" element={<Landing />} />
            <Route
              path="/workspaces"
              element={
                <RequireUser>
                  <Home />
                </RequireUser>
              }
            />
            <Route
              path="/w/:login"
              element={
                <RequireUser>
                  <AppShell />
                </RequireUser>
              }
            >
              <Route index element={<Overview />} />
              <Route path="reports" element={<Reports />} />
              <Route path="reports/:id" element={<ReportDetail />} />
              <Route path="checks" element={<Checks />} />
              <Route path="destinations" element={<Destinations />} />
              <Route path="ai" element={<Ai />} />
              <Route path="repos" element={<Repos />} />
              <Route path="audit" element={<Audit />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
