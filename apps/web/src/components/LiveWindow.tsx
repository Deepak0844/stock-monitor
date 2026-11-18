import { useEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Field } from "./Field.js";

/** The part of noVNC's viewer the app uses. */
export type RfbLike = EventTarget & {
  scaleViewport: boolean;
  disconnect(): void;
  focus(): void;
  clipboardPasteFrom(text: string): void;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
};

// X11 keysyms the window sends itself.
const XK = { BackSpace: 0xff08, Return: 0xff0d, Shift_L: 0xffe1, Shift_R: 0xffe2, Control_L: 0xffe3, Control_R: 0xffe4, Alt_L: 0xffe9, Alt_R: 0xffea, Super_L: 0xffeb, Super_R: 0xffec };
// Latin-1 keysyms equal the character code; anything else uses X11's Unicode keysym range.
const keysymOf = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return cp < 0x100 ? cp : 0x01000000 + cp;
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
  const [notice, setNotice] = useState<string | null>(null);
  // Text copied in the window that the browser would not let us put on this computer's clipboard by itself.
  const [toCopy, setToCopy] = useState<string | null>(null);
  const keyboardRef = useRef<HTMLInputElement>(null);
  const typed = useRef("");
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
    let stopKeys = () => {};

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
        // Something was copied in the window: put it on this computer's clipboard too, but only right after the owner
        // pressed copy. The supplier's website is not trusted, and its scripts can change the window's clipboard by themselves.
        let copyKeyAt = 0;
        rfb.addEventListener("clipboard", (event) => {
          const text = (event as CustomEvent<{ text: string }>).detail.text;
          if (!text || Date.now() - copyKeyAt > 3000) return;
          Promise.resolve()
            .then(() => navigator.clipboard.writeText(text))
            .then(
              () => {
                setToCopy(null);
                setNotice("Copied from the window. You can paste it on this computer.");
              },
              () => {
                setToCopy(text);
                setNotice(null);
              },
            );
        });

        const screenEl = screenRef.current as HTMLElement;
        // Runs before noVNC's own key handler. Ctrl/Cmd+V pastes this computer's clipboard into the window. Cmd+letter
        // on a Mac becomes Ctrl+letter, since noVNC sends Cmd as Alt and the remote browser expects Ctrl for copy and paste.
        const onKeyDown = (e: KeyboardEvent) => {
          if ((e.ctrlKey || e.metaKey) && (e.code === "KeyC" || e.code === "KeyX")) copyKeyAt = Date.now();
          const letter = /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase();
          if (!letter || e.altKey || !(e.metaKey || (e.ctrlKey && letter === "v"))) return;
          e.stopPropagation();
          e.preventDefault();
          const cmd = e.metaKey && !e.ctrlKey;
          const press = () => {
            if (cmd) for (const k of [XK.Alt_L, XK.Super_L]) rfb.sendKey(k, null, false);
            rfb.sendKey(XK.Control_L, "ControlLeft", true);
            // Upper case when Shift is held, or x11vnc lets go of Shift to make the lower-case letter (Cmd+Shift+Z would undo).
            rfb.sendKey(keysymOf(e.shiftKey ? letter.toUpperCase() : letter), e.code);
            // Always let go: reading the clipboard can wait for a browser prompt, and the real Ctrl key-up may already have gone.
            rfb.sendKey(XK.Control_L, "ControlLeft", false);
          };
          if (letter !== "v") return press();
          Promise.resolve()
            .then(() => navigator.clipboard.readText())
            .then(
              (text) => {
                if (text) rfb.clipboardPasteFrom(text);
              },
              () => setNotice("Your browser did not let the window read your clipboard. Use the Paste text box instead."),
            )
            .finally(press);
        };
        // A key still held when the window loses focus would never be released there (a stuck Shift types only capitals).
        const onFocusOut = () => {
          for (const k of [XK.Shift_L, XK.Shift_R, XK.Control_L, XK.Control_R, XK.Alt_L, XK.Alt_R, XK.Super_L, XK.Super_R]) rfb.sendKey(k, null, false);
        };
        screenEl.addEventListener("keydown", onKeyDown, true);
        screenEl.addEventListener("focusout", onFocusOut);
        stopKeys = () => {
          screenEl.removeEventListener("keydown", onKeyDown, true);
          screenEl.removeEventListener("focusout", onFocusOut);
        };
      };
    });

    return () => {
      cancelled = true;
      stopKeys();
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
    setNotice("Sent. Now click the field in the window and press Ctrl+V.");
  };

  const copyToComputer = () => {
    if (toCopy === null) return;
    void navigator.clipboard.writeText(toCopy).then(() => {
      setToCopy(null);
      setNotice("Copied from the window. You can paste it on this computer.");
    });
  };

  // A phone's keyboard only opens for a text box, so typing goes through a hidden one. Its text is compared with what
  // was sent before, so autocorrect and word suggestions that replace letters are sent as backspaces and new letters.
  const onKeyboardInput = (e: FormEvent<HTMLInputElement>) => {
    const rfb = rfbRef.current;
    const prev = [...typed.current];
    const next = [...e.currentTarget.value];
    let same = 0;
    while (same < prev.length && same < next.length && prev[same] === next[same]) same++;
    for (let i = same; i < prev.length; i++) rfb?.sendKey(XK.BackSpace, "Backspace");
    for (const ch of next.slice(same)) rfb?.sendKey(keysymOf(ch), null);
    typed.current = e.currentTarget.value;
  };
  const onKeyboardKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      rfbRef.current?.sendKey(XK.Return, "Enter");
      e.currentTarget.value = "";
      typed.current = "";
    } else if (e.key === "Backspace" && !e.currentTarget.value) {
      // An empty box has nothing to delete, so it sends no input event.
      rfbRef.current?.sendKey(XK.BackSpace, "Backspace");
    }
  };
  const onKeyboardBlur = (e: FocusEvent<HTMLInputElement>) => {
    e.currentTarget.value = "";
    typed.current = "";
  };

  return (
    <div className="mt-5">
      {phase === "connecting" && (
        <div className="mb-3 flex flex-col gap-2">
          <p role="status" className="text-sm font-medium">
            Opening the login window…
          </p>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        {expiresAt && (
          <p role="timer" className="font-semibold tabular-nums">
            Time left: {clock(new Date(expiresAt).getTime() - now)}
          </p>
        )}
        {phase === "live" && (
          <div className="max-w-xl flex-1 basis-96">
            <Field id="paste-text" label="Paste text" hint={<span id="paste-hint">Ctrl+V (⌘V on a Mac) in the window pastes what you copied. If your browser blocks that: send it here, click the field in the window, then press Ctrl+V.</span>}>
              <div className="flex gap-2">
                <Input id="paste-text" type="password" autoComplete="off" value={pasteText} onChange={(e) => setPasteText(e.target.value)} aria-describedby="paste-hint" />
                <Button type="button" variant="outline" className="shrink-0" onClick={sendPaste}>
                  Send to the window
                </Button>
              </div>
            </Field>
            {notice && (
              <p role="status" className="mt-2 text-sm font-medium text-success">
                {notice}
              </p>
            )}
            {toCopy !== null && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">Text was copied in the window.</p>
                <Button type="button" variant="outline" size="sm" onClick={copyToComputer}>
                  Copy it to this computer
                </Button>
              </div>
            )}
          </div>
        )}
        {phase === "live" && (
          <div className="relative pointer-fine:hidden">
            <Button type="button" variant="outline" onClick={() => keyboardRef.current?.focus()}>
              Keyboard
            </Button>
            <input
              ref={keyboardRef}
              aria-label="Type into the window"
              className="sr-only text-base"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              onInput={onKeyboardInput}
              onKeyDown={onKeyboardKeyDown}
              onBlur={onKeyboardBlur}
            />
          </div>
        )}
      </div>
      {/* The remote screen is 1280 by 800. The viewer scales it to fit this box, so it is never scrolled, and the box is kept short
          enough that the buttons above it and the window can be seen together on a laptop. */}
      <div
        ref={screenRef}
        role="group"
        aria-label="Live login window. Click it to type into the supplier's website. Use the buttons above to finish or cancel."
        className={phase === "live" ? "h-[clamp(20rem,calc(100vh-20rem),50rem)] w-full overflow-hidden rounded-xl border border-border bg-black" : "hidden"}
      />
    </div>
  );
}
