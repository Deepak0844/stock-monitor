import { useEffect, useRef, useState } from "react";

/** The part of noVNC's viewer the app uses. */
export type RfbLike = EventTarget & {
  scaleViewport: boolean;
  disconnect(): void;
  focus(): void;
  clipboardPasteFrom(text: string): void;
};
export type RfbConstructor = new (
  target: HTMLElement,
  socket: WebSocket,
  options: { credentials?: { password: string } },
) => RfbLike;

export type LiveWindowFailure = "refused" | "lost";

type Props = {
  loginSessionId: string;
  /** The one-time key to the screen. It is sent as the first message and never put in an address. */
  token: string;
  /** When the window closes by itself. */
  expiresAt: string | null;
  onConnected: () => void;
  onFailed: (reason: LiveWindowFailure) => void;
  onExpired: () => void;
  /** For tests: replaces the browser's WebSocket and the noVNC viewer. */
  createSocket?: (url: string) => WebSocket;
  loadRfb?: () => Promise<RfbConstructor>;
};

// noVNC is large, and only this screen needs it, so it is loaded when this screen opens.
const defaultLoadRfb = async (): Promise<RfbConstructor> =>
  (await import("@novnc/novnc")).default as unknown as RfbConstructor;
const defaultCreateSocket = (url: string) => new WebSocket(url);

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * The live login window: the supplier's own login page, running on the server and shown here. This opens the
 * screen's connection, sends the one-time token as the first message, and only when the server says it is
 * ready does it start the viewer on that same open connection, so no picture is ever shown before that.
 */
export function LiveWindow({
  loginSessionId,
  token,
  expiresAt,
  onConnected,
  onFailed,
  onExpired,
  createSocket = defaultCreateSocket,
  loadRfb = defaultLoadRfb,
}: Props) {
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbLike | null>(null);
  const [phase, setPhase] = useState<"connecting" | "live">("connecting");
  const [pasteText, setPasteText] = useState("");
  const [pasted, setPasted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The latest callbacks, so a parent's re-render never restarts the connection.
  const callbacks = useRef({ onConnected, onFailed, onExpired });
  callbacks.current = { onConnected, onFailed, onExpired };

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let ready = false;
    let connected = false;
    let socket: WebSocket | null = null;

    const fail = (reason: LiveWindowFailure) => {
      if (cancelled || failed) return;
      failed = true;
      callbacks.current.onFailed(reason);
    };

    void loadRfb().then((RFB) => {
      if (cancelled) return;
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = createSocket(
        `${scheme}://${window.location.host}/api/login-sessions/${encodeURIComponent(loginSessionId)}/screen`,
      );
      socket = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => ws.send(token); // the token is the first message, never in the address
      ws.onerror = () => {
        if (!ready) fail("refused");
      };
      ws.onclose = () => {
        if (!ready) fail("refused");
      };
      ws.onmessage = (event) => {
        let password: string | undefined;
        try {
          if (typeof event.data !== "string") throw new Error("not text");
          const message = JSON.parse(event.data) as { type?: unknown; vncPassword?: unknown };
          if (message.type !== "ready") throw new Error("not ready");
          password = typeof message.vncPassword === "string" ? message.vncPassword : undefined;
        } catch {
          ws.close();
          return fail("refused");
        }
        // Started right here, in this same message, so none of the screen's first bytes can arrive before it is listening.
        ready = true;
        const rfb = new RFB(
          screenRef.current as HTMLElement,
          ws,
          password ? { credentials: { password } } : {},
        );
        rfb.scaleViewport = true;
        rfbRef.current = rfb;
        rfb.addEventListener("connect", () => {
          connected = true;
          setPhase("live");
          callbacks.current.onConnected();
        });
        rfb.addEventListener("disconnect", () => fail(connected ? "lost" : "refused"));
        rfb.addEventListener("credentialsrequired", () => fail("refused"));
        rfb.addEventListener("securityfailure", () => fail("refused"));
      };
    });

    return () => {
      cancelled = true;
      rfbRef.current?.disconnect();
      rfbRef.current = null;
      socket?.close();
    };
  }, [loginSessionId, token, createSocket, loadRfb]);

  // The countdown. It tells the page once when the time is up.
  useEffect(() => {
    if (!expiresAt) return;
    const end = new Date(expiresAt).getTime();
    let told = false;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= end && !told) {
        told = true;
        callbacks.current.onExpired();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const sendPaste = () => {
    if (!pasteText) return;
    rfbRef.current?.clipboardPasteFrom(pasteText);
    setPasteText("");
    setPasted(true);
  };

  return (
    <div className="live-window">
      {phase === "connecting" && (
        <p role="status" className="status">
          Opening the login window…
        </p>
      )}
      <div className="live-toolbar">
        {expiresAt && (
          <p role="timer" className="timer">
            Time left: {clock(new Date(expiresAt).getTime() - now)}
          </p>
        )}
        {phase === "live" && (
          <div className="paste-box">
            <div className="field">
              <label htmlFor="paste-text">Paste text</label>
              <div className="search-row">
                <input
                  id="paste-text"
                  type="password"
                  autoComplete="off"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  aria-describedby="paste-hint"
                />
                <button type="button" className="button secondary" onClick={sendPaste}>
                  Send to the window
                </button>
              </div>
              <p id="paste-hint" className="hint">
                For a password from your password manager: send it, click the field in the window,
                then press Ctrl+V.
              </p>
            </div>
            {pasted && (
              <p role="status" className="status">
                Sent. Now click the field in the window and press Ctrl+V.
              </p>
            )}
          </div>
        )}
      </div>
      <div
        ref={screenRef}
        role="group"
        aria-label="Live login window. Click it to type into the supplier's website. Use the buttons above to finish or cancel."
        className={phase === "live" ? "screen" : "screen is-pending"}
      />
    </div>
  );
}
