// A stand-in VNC client, run inside the container (its port is not published). It connects, logs in
// with the password in PROBE_PASSWORD (or tries with none), asks for one full picture of the screen,
// and prints what it found as JSON. Run with --openssl-legacy-provider: VNC's password check uses DES.
import { Buffer } from "node:buffer";
import { createCipheriv } from "node:crypto";
import net from "node:net";
import process from "node:process";

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const password = process.env.PROBE_PASSWORD;

const socket = net.connect(5900, "127.0.0.1");
let buffer = Buffer.alloc(0);
let waiting = null;
socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  waiting?.();
});
socket.on("error", (e) => {
  print({ error: e.message });
  process.exit(1);
});
const read = async (n) => {
  while (buffer.length < n) await new Promise((resolve) => (waiting = resolve));
  const out = buffer.subarray(0, n);
  buffer = buffer.subarray(n);
  return out;
};
const finish = (result) => {
  print(result);
  socket.destroy();
  process.exit(0);
};

const banner = (await read(12)).toString("latin1").trim();
socket.write("RFB 003.008\n");
const [count] = await read(1);
const securityTypes = [...(await read(count))];

if (password === undefined) {
  // With no password, the only way in would be the "none" type. It must not be offered.
  if (!securityTypes.includes(1)) finish({ banner, securityTypes, offeredNone: false });
  socket.write(Buffer.from([1]));
} else {
  if (!securityTypes.includes(2)) throw new Error("no password login offered");
  socket.write(Buffer.from([2]));
  const challenge = await read(16);
  // VNC takes the first 8 characters of the password as a DES key, with the bits of each byte reversed.
  const key = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    const byte = password.charCodeAt(i) || 0;
    let flipped = 0;
    for (let bit = 0; bit < 8; bit++) flipped |= ((byte >> bit) & 1) << (7 - bit);
    key[i] = flipped;
  }
  const cipher = createCipheriv("des-ecb", key, null);
  cipher.setAutoPadding(false);
  socket.write(Buffer.concat([cipher.update(challenge), cipher.final()]));
}
if ((await read(4)).readUInt32BE(0) !== 0) finish({ banner, securityTypes, authFailed: true });

socket.write(Buffer.from([1])); // shared
const init = await read(24);
const width = init.readUInt16BE(0);
const height = init.readUInt16BE(2);
const bytesPerPixel = init[4] / 8;
await read(init.readUInt32BE(20)); // the desktop's name

// Raw pixels only, then ask for the whole screen.
socket.write(Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]));
const request = Buffer.alloc(10);
request[0] = 3;
request.writeUInt16BE(width, 6);
request.writeUInt16BE(height, 8);
socket.write(request);

const head = await read(4);
if (head[0] !== 0) throw new Error("not a framebuffer update");
const colours = new Set();
for (let i = 0; i < head.readUInt16BE(2); i++) {
  const rect = await read(12);
  const pixels = await read(rect.readUInt16BE(4) * rect.readUInt16BE(6) * bytesPerPixel);
  for (let p = 0; p + bytesPerPixel <= pixels.length; p += bytesPerPixel) colours.add(pixels.readUInt32LE(p) & 0xffffff);
}
finish({ banner, securityTypes, width, height, colours: colours.size });
