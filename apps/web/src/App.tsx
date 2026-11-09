import { useCallback, useEffect, useState } from "react";
import { api as realApi, type Api } from "./api.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { ProductsPage } from "./pages/ProductsPage.js";
import { ConnectSupplierPage } from "./pages/ConnectSupplierPage.js";
import { ImportMappingsPage } from "./pages/ImportMappingsPage.js";
import { MappingFormPage } from "./pages/MappingFormPage.js";
import { MappingsPage } from "./pages/MappingsPage.js";
import { SupplierFormPage } from "./pages/SupplierFormPage.js";
import { SuppliersPage } from "./pages/SuppliersPage.js";
import { SettingsShopifyPage } from "./pages/SettingsShopifyPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { AppShell } from "./shell/AppShell.js";
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
  const connectId = /^\/suppliers\/([^/]+)\/connect$/.exec(path)?.[1];

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
      <p role="status" className="status">
        Loading…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="auth-single">
        <div className="card">
          <p role="alert" className="form-error">
            {state.message}
          </p>
          <button type="button" className="button primary" onClick={checkSession}>
            Try again
          </button>
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
