import RFB from "/novnc/core/rfb.js";
const stateEl = document.getElementById("state");
const set = (s) => { window.__state = s; stateEl.textContent = s; };

async function start() {
  const target = new URLSearchParams(location.search).get("target");
  const res = await fetch("/api/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: target }) });
  if (!res.ok) { set("start-refused-" + res.status); return; }
  const { token } = await res.json();
  window.__token = token; // spike only, so the driver can test reuse
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/screen");
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(token); // the token is the first message, never in the address
  ws.onclose = () => { if (window.__state !== "connected") set("handshake-refused"); };
  ws.onmessage = (event) => {
    if (event.data !== "ok") { set("handshake-refused"); return; }
    ws.onmessage = null; ws.onclose = null;
    const rfb = new RFB(document.getElementById("screen"), ws); // an already-open WebSocket
    rfb.scaleViewport = true;
    rfb.addEventListener("connect", () => set("connected"));
    rfb.addEventListener("disconnect", () => set("disconnected"));
    window.__rfb = rfb;
  };
}
// "Paste text" box, as in the spec: send the text to the remote clipboard, then the owner presses Ctrl+V in the remote page.
document.getElementById("send-paste").onclick = () => {
  const box = document.getElementById("paste-text");
  window.__rfb?.clipboardPasteFrom(box.value);
  box.value = "";
};
start();
