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
import { AccountPage } from "./pages/settings/AccountPage.js";
import { AppearancePage } from "./pages/settings/AppearancePage.js";
import { SettingsLayout } from "./pages/settings/SettingsLayout.js";
import { SuggestionsPage } from "./pages/settings/SuggestionsPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { AppShell } from "./shell/AppShell.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { useQueryClient } from "@tanstack/react-query";
import { createQueryClient } from "./store/api/api.js";
import { proposalKeys, useGetProposalCountQuery } from "./store/api/proposals/proposalApi.js";
import { useGetScheduleOverviewQuery } from "./store/api/schedule/scheduleApi.js";
import { useCheckSessionAgain, useGetMeQuery, useLoginMutation, useLogoutMutation } from "./store/api/auth/authApi.js";
import { StoreProvider } from "./store/StoreProvider.js";
import { setWaiting } from "./tabTitle.js";
import { useNotifications } from "./shell/useNotifications.js";
import { redirect, usePath } from "./router.js";

type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "signedIn"; email: string }
  | { kind: "error"; message: string };

const SCHEDULE_POLL_MS = 60_000;
/** Where to go after signing in: only an address inside this app ("/suppliers"), never another site ("//x", "https://x"). */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

export function App({ api = realApi }: { api?: Api }) {
  // One cache for the life of the page.
  const [queryClient] = useState(createQueryClient);
  return (
    <StoreProvider api={api} client={queryClient}>
      <AppRoutes api={api} />
    </StoreProvider>
  );
}

function AppRoutes({ api }: { api: Api }) {
  // Who is signed in, from the cache. A sign-out that failed shows its own error until Try again.
  const me = useGetMeQuery();
  const [failure, setFailure] = useState<string | null>(null);
  const state: State = failure
    ? { kind: "error", message: failure }
    : me.data
      ? { kind: "signedIn", email: me.data.email }
      : me.data === null
        ? { kind: "signedOut" }
        : me.isError && !me.isFetching
          ? { kind: "error", message: messageOf(me.error) }
          : { kind: "loading" };
  const login = useLoginMutation();
  const logout = useLogoutMutation({ onSignedOut: () => redirect("/login") });
  const checkSessionAgain = useCheckSessionAgain();
  const queryClient = useQueryClient();
  const path = usePath();
  const editId = /^\/suppliers\/([^/]+)\/edit$/.exec(path)?.[1];
  const mappingEditId = /^\/mappings\/([^/]+)\/edit$/.exec(path)?.[1];
  const rulesId = /^\/suppliers\/([^/]+)\/rules$/.exec(path)?.[1];
  const connectId = /^\/suppliers\/([^/]+)\/connect$/.exec(path)?.[1];

  const signedIn = state.kind === "signedIn";
  const proposalCount = useGetProposalCountQuery({ enabled: signedIn }).data ?? 0;
  const notifications = useNotifications(signedIn);
  const reloadNotifications = notifications.reload;
  // How many suggestions are waiting, for the menu. Read again when the owner moves to another page and the count is over 30 s old.
  const refreshCount = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: proposalKeys.count(), stale: true });
    reloadNotifications();
  }, [queryClient, reloadNotifications]);
  useEffect(() => {
    if (signedIn) refreshCount();
  }, [signedIn, path, refreshCount]);

  // The browser tab shows the waiting count, and its icon a dot while anything needs the owner.
  const attention = notifications.items.length;
  useEffect(
    () => setWaiting(signedIn ? proposalCount : 0, signedIn && attention > 0),
    [signedIn, proposalCount, attention],
  );

  // The schedule, for the check status in the sidebar. Read when signed in and every minute after, while the tab is shown.
  const schedule = useGetScheduleOverviewQuery({ enabled: signedIn, refetchEvery: SCHEDULE_POLL_MS }).data ?? null;

  const checkSession = () => {
    setFailure(null);
    void checkSessionAgain();
  };

  // Signed out, every address shows the sign-in page at /login, remembering where the owner was going. Signed in, /login moves
  // on to that page, or to the Dashboard.
  useEffect(() => {
    if (state.kind === "signedOut" && path !== "/login") {
      const going = path + window.location.search;
      redirect(going === "/" ? "/login" : `/login?next=${encodeURIComponent(going)}`);
    }
    if (state.kind === "signedIn" && path === "/login") redirect(safeNext(new URLSearchParams(window.location.search).get("next")));
  }, [state.kind, path]);

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
          await login.mutateAsync({ email, password });
        }}
      />
    );
  }

  // Signing out empties the cache, so nothing from this session is shown afterwards.
  const signOut = () =>
    logout.mutateAsync().catch((e: unknown) => setFailure(messageOf(e)));

  return (
    <TooltipProvider delayDuration={400}>
      <AppShell
        email={state.email}
        proposalCount={proposalCount}
        attentionCount={notifications.items.length}
        schedule={schedule}
        notifications={notifications}
        onSignOut={signOut}
      >
        {path === "/" ? (
          <DashboardPage />
        ) : path === "/products" ? (
          <ProductsPage />
        ) : path === "/proposals" ? (
          <ProposalsPage api={api} />
        ) : path === "/suppliers" ? (
          <SuppliersPage api={api} />
        ) : path === "/suppliers/new" ? (
          <SupplierFormPage api={api} />
        ) : path === "/mappings" ? (
          <MappingsPage api={api} />
        ) : path === "/mappings/new" ? (
          <MappingFormPage />
        ) : path === "/mappings/import" ? (
          <ImportMappingsPage api={api} />
        ) : mappingEditId ? (
          <MappingFormPage key={mappingEditId} id={mappingEditId} />
        ) : rulesId ? (
          <StockRulesPage key={rulesId} api={api} supplierId={rulesId} />
        ) : connectId ? (
          <ConnectSupplierPage key={connectId} api={api} supplierId={connectId} />
        ) : editId ? (
          <SupplierFormPage key={editId} api={api} id={editId} />
        ) : path === "/settings" || path === "/settings/shopify" ? (
          <SettingsLayout current="shopify">
            <SettingsShopifyPage api={api} />
          </SettingsLayout>
        ) : path === "/settings/suggestions" ? (
          <SettingsLayout current="suggestions">
            <SuggestionsPage />
          </SettingsLayout>
        ) : path === "/settings/appearance" ? (
          <SettingsLayout current="appearance">
            <AppearancePage />
          </SettingsLayout>
        ) : path === "/settings/account" ? (
          <SettingsLayout current="account">
            <AccountPage email={state.email} onSignOut={signOut} />
          </SettingsLayout>
        ) : (
          <NotFoundPage />
        )}
      </AppShell>
    </TooltipProvider>
  );
}
