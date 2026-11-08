import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { Api, LoginSession, Supplier } from "../api.js";
import { LiveWindow, type LiveWindowFailure } from "../components/LiveWindow.js";
import { Notice } from "../components/Notice.js";
import { Link, navigate } from "../router.js";
import { useTitle } from "../useTitle.js";

type WindowProps = {
  loginSessionId: string;
  token: string;
  expiresAt: string | null;
  onConnected: () => void;
  onFailed: (reason: LiveWindowFailure) => void;
  onExpired: () => void;
};

type State =
  | { kind: "starting" }
  | { kind: "window"; loginSession: LoginSession; token: string; connected: boolean; saving: boolean }
  | { kind: "done" }
  | { kind: "error"; message: string; canRetry: boolean };

const MESSAGES = {
  refused: "The login window could not be opened. Please try again.",
  lost: "The connection to the login window was lost. Please try again.",
  expired: "The login window closed because time ran out. Start again.",
} as const;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/**
 * Connecting a supplier: the owner logs in by hand in a live window, then presses "I'm logged in".
 * Only one login can be open, so the page cancels what it opened whenever it is left, closed or retried.
 */
export function ConnectSupplierPage({ api, supplierId, liveWindow: Window = LiveWindow }: { api: Api; supplierId: string; liveWindow?: ComponentType<WindowProps> }) {
  useTitle("Connect supplier");
  const [supplier, setSupplier] = useState<Supplier | null>(null);
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
          setSupplier(await api.suppliers.get(supplierId));
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
      <div className="page-header">
        <h1>{name ? `${again ? "Reconnect" : "Connect"} ${name}` : "Connect supplier"}</h1>
        <p className="muted">Log in as you normally would. Solve any puzzle or code. Then press I'm logged in.</p>
      </div>

      <div className="desktop-hint">
        <Notice kind="info">Connecting a supplier works best on a computer. You can still check status and messages on your phone.</Notice>
      </div>

      {state.kind === "starting" && (
        <p role="status" className="status">
          Opening the login window…
        </p>
      )}

      {state.kind === "window" && (
        <>
          {/* The buttons come before the window, so keyboard and screen reader users reach them first. */}
          <div className="actions">
            <button type="button" className="button primary" disabled={!state.connected || state.saving} aria-busy={state.saving} onClick={() => void finish()}>
              {state.saving ? "Saving…" : "I'm logged in"}
            </button>
            <button type="button" className="button secondary" disabled={state.saving} onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
          <Window
            loginSessionId={state.loginSession.id}
            token={state.token}
            expiresAt={state.loginSession.expiresAt}
            onConnected={() => setState((s) => (s.kind === "window" ? { ...s, connected: true } : s))}
            onFailed={(reason) => problem(MESSAGES[reason])}
            onExpired={() => problem(MESSAGES.expired)}
          />
        </>
      )}

      {state.kind === "done" && (
        <>
          <Notice kind="success" role="status">
            {name ?? "The supplier"} is connected.
          </Notice>
          <div className="actions">
            <Link to="/suppliers" className="button primary inline">
              Back to suppliers
            </Link>
          </div>
        </>
      )}

      {state.kind === "error" && (
        <>
          <Notice kind="error" role="alert">
            {state.message}
          </Notice>
          <div className="actions">
            {state.canRetry && (
              <button type="button" className="button primary" onClick={() => void tryAgain()}>
                Try again
              </button>
            )}
            <Link to="/suppliers" className="button secondary">
              Back to suppliers
            </Link>
          </div>
        </>
      )}
    </>
  );
}
