// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveWindow, type RfbConstructor } from "./LiveWindow.js";

const TOKEN = "f".repeat(64);
const ID = "22222222-2222-4222-8222-222222222222";

/** A stand-in for the browser's WebSocket that a test can drive. */
class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  closed = false;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  say(data: unknown) {
    this.onmessage?.({ data });
  }
  drop() {
    this.onclose?.();
  }
}

/** A stand-in for noVNC's RFB. */
class FakeRfb extends EventTarget {
  static all: FakeRfb[] = [];
  scaleViewport = false;
  disconnected = false;
  pasted: string[] = [];
  constructor(readonly target: HTMLElement, readonly socket: FakeSocket, readonly options: { credentials?: { password: string } }) {
    super();
    FakeRfb.all.push(this);
  }
  disconnect() {
    this.disconnected = true;
  }
  focus() {}
  clipboardPasteFrom(text: string) {
    this.pasted.push(text);
  }
  fire(type: string, detail: unknown = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

const handlers = () => ({ onConnected: vi.fn(), onFailed: vi.fn(), onExpired: vi.fn() });
const flush = () => act(async () => {});

function setup(over: Partial<Parameters<typeof LiveWindow>[0]> = {}) {
  const h = handlers();
  render(
    <LiveWindow
      loginSessionId={ID}
      token={TOKEN}
      expiresAt={new Date(Date.now() + 15 * 60_000).toISOString()}
      {...h}
      createSocket={(url) => new FakeSocket(url) as never}
      loadRfb={async () => FakeRfb as unknown as RfbConstructor}
      {...over}
    />,
  );
  return h;
}
const socket = () => FakeSocket.all.at(-1)!;
/** Gets as far as a ready message, the way the server does it. */
async function connectToReady(message: unknown = { type: "ready", vncPassword: "Ab3dE6gH" }) {
  await flush();
  socket().open();
  socket().say(JSON.stringify(message));
}

beforeEach(() => {
  FakeSocket.all = [];
  FakeRfb.all = [];
  window.history.replaceState(null, "", "/suppliers/s1/connect");
});
afterEach(cleanup);

describe("opening the screen", () => {
  it("opens the screen of this login on the same site, and sends the token as the first message, never in the address", async () => {
    setup();
    await flush();
    expect(socket().url).toBe(`ws://${window.location.host}/api/login-sessions/${ID}/screen`);
    expect(socket().url).not.toContain(TOKEN);
    expect(socket().sent).toEqual([]); // nothing is sent until the connection is open
    socket().open();
    expect(socket().sent).toEqual([TOKEN]);
  });

  it("uses a secure socket when the page is secure", async () => {
    const original = window.location;
    Object.defineProperty(window, "location", { value: { ...original, protocol: "https:", host: "stock.example.com" }, configurable: true });
    try {
      setup();
      await flush();
      expect(socket().url).toBe(`wss://stock.example.com/api/login-sessions/${ID}/screen`);
    } finally {
      Object.defineProperty(window, "location", { value: original, configurable: true });
    }
  });

  it("says it is opening the window, and shows no window until the server says ready", async () => {
    setup();
    await flush();
    socket().open();
    expect(screen.getByRole("status")).toHaveTextContent("Opening the login window…");
    expect(FakeRfb.all).toHaveLength(0);
  });
});

describe("the ready message", () => {
  it("starts the viewer on the open socket, with the VNC password, as soon as it arrives", async () => {
    setup();
    await connectToReady();
    const rfb = FakeRfb.all[0]!;
    expect(rfb.socket).toBe(socket());
    expect(rfb.options).toEqual({ credentials: { password: "Ab3dE6gH" } });
    expect(rfb.scaleViewport).toBe(true);
    expect(rfb.target).toBe(screen.getByRole("group", { name: /live login window/i }));
  });

  it("starts the viewer with no credentials when the server sent no password", async () => {
    setup();
    await connectToReady({ type: "ready" });
    expect(FakeRfb.all[0]?.options).toEqual({});
  });

  it("shows the window and reports it once the viewer has connected", async () => {
    const h = setup();
    await connectToReady();
    expect(h.onConnected).not.toHaveBeenCalled();
    act(() => FakeRfb.all[0]!.fire("connect"));
    expect(h.onConnected).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Opening the login window…")).toBeNull();
  });
});

describe("when the screen cannot be opened", () => {
  it.each([
    ["something that is not JSON", "not json"],
    ["a message that is not ready", JSON.stringify({ type: "hello" })],
    ["a binary message", new ArrayBuffer(4)],
  ])("fails, closes the socket and starts no viewer on %s", async (_n, data) => {
    const h = setup();
    await flush();
    socket().open();
    socket().say(data);
    expect(h.onFailed).toHaveBeenCalledWith("refused");
    expect(socket().closed).toBe(true);
    expect(FakeRfb.all).toHaveLength(0);
  });

  it("fails when the connection closes before the server says ready", async () => {
    const h = setup();
    await flush();
    socket().open();
    socket().drop();
    expect(h.onFailed).toHaveBeenCalledWith("refused");
  });

  it("fails when the connection cannot be made at all", async () => {
    const h = setup();
    await flush();
    socket().onerror?.();
    expect(h.onFailed).toHaveBeenCalledWith("refused");
  });

  it("fails, once, when the viewer is asked for a password it was not given", async () => {
    const h = setup();
    await connectToReady({ type: "ready" });
    act(() => FakeRfb.all[0]!.fire("credentialsrequired"));
    act(() => FakeRfb.all[0]!.fire("securityfailure", { reason: "x" }));
    expect(h.onFailed).toHaveBeenCalledTimes(1);
    expect(h.onFailed).toHaveBeenCalledWith("refused");
  });
});

describe("after the window was working", () => {
  it("says the connection was lost when the viewer disconnects, clean or not", async () => {
    const h = setup();
    await connectToReady();
    act(() => FakeRfb.all[0]!.fire("connect"));
    act(() => FakeRfb.all[0]!.fire("disconnect", { clean: false }));
    expect(h.onFailed).toHaveBeenCalledWith("lost");
  });

  it("does not report a disconnect the page asked for itself", async () => {
    const h = setup();
    await connectToReady();
    act(() => FakeRfb.all[0]!.fire("connect"));
    cleanup();
    expect(FakeRfb.all[0]!.disconnected).toBe(true);
    expect(socket().closed).toBe(true);
    expect(h.onFailed).not.toHaveBeenCalled();
  });
});

describe("pasting text", () => {
  async function live() {
    const user = userEvent.setup();
    setup();
    await connectToReady();
    act(() => FakeRfb.all[0]!.fire("connect"));
    return { user, rfb: FakeRfb.all[0]! };
  }

  it("sends what is typed to the remote clipboard, then clears the box so a password does not linger", async () => {
    const { user, rfb } = await live();
    const box = screen.getByLabelText("Paste text");
    expect(box).toHaveAttribute("type", "password");
    expect(box).toHaveAttribute("autocomplete", "off");
    await user.type(box, "p@ss w0rd");
    await user.click(screen.getByRole("button", { name: "Send to the window" }));
    expect(rfb.pasted).toEqual(["p@ss w0rd"]);
    expect(box).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(/click the field.*Ctrl\+V/i);
  });

  it("sends nothing when the box is empty", async () => {
    const { user, rfb } = await live();
    await user.click(screen.getByRole("button", { name: "Send to the window" }));
    expect(rfb.pasted).toEqual([]);
  });

  it("is only offered once the window is working", async () => {
    setup();
    await flush();
    expect(screen.queryByLabelText("Paste text")).toBeNull();
  });
});

describe("the countdown", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("shows the time left, counting down", async () => {
    setup({ expiresAt: new Date(Date.now() + 125_000).toISOString() });
    expect(screen.getByRole("timer")).toHaveTextContent("Time left: 2:05");
    act(() => void vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("timer")).toHaveTextContent("Time left: 2:00");
  });

  it("says once when time has run out, and shows 0:00", async () => {
    const h = setup({ expiresAt: new Date(Date.now() + 3_000).toISOString() });
    act(() => void vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("timer")).toHaveTextContent("Time left: 0:00");
    expect(h.onExpired).toHaveBeenCalledTimes(1);
  });

  it("shows no countdown when the server gave no end time", async () => {
    setup({ expiresAt: null });
    expect(screen.queryByRole("timer")).toBeNull();
  });
});
