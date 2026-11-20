import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button.js";
import type { Api, LoginSession, Supplier } from "../api.js";
import { LiveWindow, type LiveWindowFailure } from "../components/LiveWindow.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { Link, navigate } from "../router.js";
import { useTitle } from "../useTitle.js";
import { useFetchSupplier } from "../store/api/suppliers/supplierApi.js";

type WindowProps = {
  loginSessionId: string;
  token: string;
  expiresAt: string | null;
  onConnected: () => void;
  onFailed: (reason: LiveWindowFailure) => void;
  onExpired: () => void;
  bar?: ReactNode;
};

type State =
  | { kind: "starting" }
  | {
      kind: "window";
      loginSession: LoginSession;
      token: string;
      connected: boolean;
      saving: boolean;
    }
  | { kind: "done" }
  | { kind: "error"; message: string; canRetry: boolean };

const MESSAGES = {
  refused: "The login window could not be opened. Please try again.",
  lost: "The connection to the login window was lost. Please try again.",
  expired: "The login window closed because time ran out. Start again.",
} as const;

const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

/**
 * Connecting a supplier: the owner logs in by hand in a live window, then presses "I'm logged in".
 * Only one login can be open, so the page cancels what it opened whenever it is left, closed or retried.
 */
const STEPS: [string, string][] = [
  ["Log in as you normally would", "Your usual email and password, on the supplier's own website."],
  ["Solve any puzzle or code", "Codes sent by email are filled in for you when email is set up."],
  ["Press I'm logged in", "The app saves the login and checks it works."],
];

/** The supplier's login page, as an address bar shows it. */
function address(s: Supplier | null): string {
  if (!s) return "";
  try {
    const u = new URL(s.loginUrl ?? s.websiteUrl);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return s.loginUrl ?? s.websiteUrl;
  }
}

export function ConnectSupplierPage({
  api,
  supplierId,
  liveWindow: Window = LiveWindow,
}: {
  api: Api;
  supplierId: string;
  liveWindow?: ComponentType<WindowProps>;
}) {
  useTitle("Connect supplier");
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const fetchSupplier = useFetchSupplier();
  const [state, setState] = useState<State>({ kind: "starting" });
  const stateRef = useRef(state);
  stateRef.current = state;
  /** The login that is open on the server, if there is one. Cleared as soon as it is finished or cancelled. */
  const open = useRef<LoginSession | null>(null);
  const mounted = useRef(false);
  const started = useRef(false);

  /** Asks the server to cancel an open login without waiting, for when the page is going away. */
  const leave = useCallback(() => {
    const login = open.current;
    if (!login) return;
    open.current = null;
    api.loginSessions.cancelOnLeave(login.id);
  }, [api]);

  const begin = useCallback(async () => {
    setState({ kind: "starting" });
    try {
      const { loginSession, token } = await api.loginSessions.start(supplierId);
      if (!mounted.current) return api.loginSessions.cancelOnLeave(loginSession.id); // the page was left while it opened
      open.current = loginSession;
      setState({ kind: "window", loginSession, token, connected: false, saving: false });
    } catch (error) {
      if (mounted.current) setState({ kind: "error", message: messageOf(error), canRetry: true });
    }
  }, [api, supplierId]);

  useEffect(() => {
    mounted.current = true;
    // React runs effects twice in development. Only one login may be opened.
    if (!started.current) {
      started.current = true;
      void (async () => {
        try {
          setSupplier(await fetchSupplier(supplierId));
        } catch (error) {
          setState({ kind: "error", message: messageOf(error), canRetry: false });
          return;
        }
        await begin();
      })();
    }
    window.addEventListener("pagehide", leave);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  async function finish() {
    const s = stateRef.current;
    if (s.kind !== "window" || !s.connected || s.saving) return;
    setState({ ...s, saving: true });
    try {
      await api.loginSessions.finish(s.loginSession.id);
      open.current = null;
      setState({ kind: "done" });
    } catch (error) {
      open.current = null; // the server has ended that login, whatever went wrong
      setState({ kind: "error", message: messageOf(error), canRetry: true });
    }
  }

  async function cancel() {
    const s = stateRef.current;
    if (s.kind !== "window" || s.saving) return;
    const login = open.current;
    open.current = null;
    if (login) await api.loginSessions.cancel(login.id).catch(() => {});
    navigate("/suppliers");
  }

  async function tryAgain() {
    // A second login cannot start while one is open, so close the old one first.
    const login = open.current;
    open.current = null;
    if (login) await api.loginSessions.cancel(login.id).catch(() => {});
    await begin();
  }

  // The window going away is expected while a login is being saved, so it is only a problem before that.
  const problem = (message: string) => {
    const s = stateRef.current;
    if (s.kind === "window" && !s.saving) setState({ kind: "error", message, canRetry: true });
  };

  const name = supplier?.name;
  const again = supplier !== null && supplier.sessionStatus !== "not_connected";

  return (
    <>
      <PageHeader
        back={{ to: "/suppliers", label: "Back to suppliers" }}
        title={name ? `${again ? "Reconnect" : "Connect"} ${name}` : "Connect supplier"}
        description="Log in as you normally would. Solve any puzzle or code. Then press I'm logged in."
      />

      <div className="mb-4 min-[897px]:hidden">
        <Notice kind="info">
          Connecting a supplier works best on a computer. You can still check status and messages on
          your phone.
        </Notice>
      </div>

      {state.kind === "starting" && (
        <p role="status" className="text-sm font-medium">
          Opening the login window…
        </p>
      )}

      {state.kind === "window" && (
        <div className="grid gap-0 border border-border lg:grid-cols-[17rem_minmax(0,1fr)]">
          {/* The guide and its buttons come before the window, so keyboard and screen reader users reach them first. */}
          <div className="flex flex-col gap-4 border-border bg-card p-4 max-lg:border-b lg:border-r">
            <ol aria-label="Steps" className="flex flex-col gap-3">
              {STEPS.map(([title, detail], i) => (
                <li key={title} className="flex gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] border-foreground font-mono text-xs font-semibold"
                  >
                    {i + 1}
                  </span>
                  <span>
                    <b className="block font-medium">{title}</b>
                    <span className="block text-[0.8125rem] text-muted-foreground">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
            <Button
              className="w-full"
              disabled={!state.connected || state.saving}
              loading={state.saving}
              onClick={() => void finish()}
            >
              {state.saving ? "Saving…" : "I'm logged in"}
            </Button>
            <Button
              className="w-full"
              variant="outline"
              disabled={state.saving}
              onClick={() => void cancel()}
            >
              Cancel
            </Button>
          </div>
          <div className="min-w-0 p-3">
            <Window
              loginSessionId={state.loginSession.id}
              token={state.token}
              expiresAt={state.loginSession.expiresAt}
              onConnected={() =>
                setState((s) => (s.kind === "window" ? { ...s, connected: true } : s))
              }
              onFailed={(reason) => problem(MESSAGES[reason])}
              onExpired={() => problem(MESSAGES.expired)}
              bar={
                <div
                  role="group"
                  aria-label="Supplier website"
                  className="flex items-center gap-3 rounded-t-md border border-b-0 border-border bg-sidebar px-3 py-2 text-[0.8125rem]"
                >
                  {state.connected ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-good">
                      <span aria-hidden="true" className="size-2 rounded-full bg-good" />
                      Live
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Connecting…</span>
                  )}
                  <span className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2.5 py-1 font-mono text-xs text-ink-soft">
                    {address(supplier)}
                  </span>
                </div>
              }
            />
          </div>
        </div>
      )}

      {state.kind === "done" && (
        <div className="flex max-w-2xl flex-col items-start gap-4">
          <Notice kind="success" role="status">
            {name ?? "The supplier"} is connected.
          </Notice>
          <Button asChild>
            <Link to="/suppliers">Back to suppliers</Link>
          </Button>
        </div>
      )}

      {state.kind === "error" && (
        <div className="flex max-w-2xl flex-col items-start gap-4">
          <Notice kind="error" role="alert">
            {state.message}
          </Notice>
          <div className="flex flex-wrap gap-2">
            {state.canRetry && <Button onClick={() => void tryAgain()}>Try again</Button>}
            <Button variant="outline" asChild>
              <Link to="/suppliers">Back to suppliers</Link>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
