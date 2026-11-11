import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { api as realApi, type Api } from "./api.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { ProposalsPage } from "./pages/ProposalsPage.js";
import { ProductsPage } from "./pages/ProductsPage.js";
import { ConnectSupplierPage } from "./pages/ConnectSupplierPage.js";
import { ImportMappingsPage } from "./pages/ImportMappingsPage.js";
import { MappingFormPage } from "./pages/MappingFormPage.js";
import { MappingsPage } from "./pages/MappingsPage.js";
import { StockRulesPage } from "./pages/StockRulesPage.js";
import { SupplierFormPage } from "./pages/SupplierFormPage.js";
import { SuppliersPage } from "./pages/SuppliersPage.js";
import { SettingsShopifyPage } from "./pages/SettingsShopifyPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { AppShell } from "./shell/AppShell.js";
import { useNotifications } from "./shell/useNotifications.js";
import { usePath } from "./router.js";

type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "signedIn"; email: string }
  | { kind: "error"; message: string };

const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

export function App({ api = realApi }: { api?: Api }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const path = usePath();
  const editId = /^\/suppliers\/([^/]+)\/edit$/.exec(path)?.[1];
  const mappingEditId = /^\/mappings\/([^/]+)\/edit$/.exec(path)?.[1];
  const rulesId = /^\/suppliers\/([^/]+)\/rules$/.exec(path)?.[1];
  const connectId = /^\/suppliers\/([^/]+)\/connect$/.exec(path)?.[1];

  const [proposalCount, setProposalCount] = useState(0);
  const signedIn = state.kind === "signedIn";
  const notifications = useNotifications(api, signedIn);
  const reloadNotifications = notifications.reload;
  // How many suggestions are waiting, for the menu. Read again whenever the owner moves to another page.
  const refreshCount = useCallback(() => {
    api.proposals.count().then(setProposalCount).catch(() => {});
    reloadNotifications();
  }, [api, reloadNotifications]);
  useEffect(() => {
    if (signedIn) refreshCount();
  }, [signedIn, path, refreshCount]);

  const checkSession = useCallback(() => {
    setState({ kind: "loading" });
    api
      .getMe()
      .then((owner) => setState(owner ? { kind: "signedIn", email: owner.email } : { kind: "signedOut" }))
      .catch((e: unknown) => setState({ kind: "error", message: messageOf(e) }));
  }, [api]);

  useEffect(checkSession, [checkSession]);

  if (state.kind === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="flex w-full max-w-xs flex-col gap-3">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <div className="flex w-full max-w-sm flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <p role="alert" className="text-sm font-medium text-danger">
            {state.message}
          </p>
          <Button onClick={checkSession}>Try again</Button>
        </div>
      </main>
    );
  }

  if (state.kind === "signedOut") {
    return (
      <LoginPage
        onLogin={async (email, password) => {
          const owner = await api.login(email, password);
          setState({ kind: "signedIn", email: owner.email });
        }}
      />
    );
  }

  return (
    <AppShell
      email={state.email}
      proposalCount={proposalCount}
      attentionCount={notifications.items.length}
      notifications={notifications}
      onSignOut={() =>
        api
          .logout()
          .then(() => setState({ kind: "signedOut" }))
          .catch((e: unknown) => setState({ kind: "error", message: messageOf(e) }))
      }
    >
      {path === "/" ? (
        <DashboardPage api={api} />
      ) : path === "/products" ? (
        <ProductsPage api={api} />
      ) : path === "/proposals" ? (
        <ProposalsPage api={api} onChange={refreshCount} />
      ) : path === "/suppliers" ? (
        <SuppliersPage api={api} />
      ) : path === "/suppliers/new" ? (
        <SupplierFormPage api={api} />
      ) : path === "/mappings" ? (
        <MappingsPage api={api} />
      ) : path === "/mappings/new" ? (
        <MappingFormPage api={api} />
      ) : path === "/mappings/import" ? (
        <ImportMappingsPage api={api} />
      ) : mappingEditId ? (
        <MappingFormPage key={mappingEditId} api={api} id={mappingEditId} />
      ) : rulesId ? (
        <StockRulesPage key={rulesId} api={api} supplierId={rulesId} />
      ) : connectId ? (
        <ConnectSupplierPage key={connectId} api={api} supplierId={connectId} />
      ) : editId ? (
        <SupplierFormPage key={editId} api={api} id={editId} />
      ) : path === "/settings" || path === "/settings/shopify" ? (
        <SettingsShopifyPage api={api} />
      ) : (
        <NotFoundPage />
      )}
    </AppShell>
  );
}
