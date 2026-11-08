// A stand-in VNC client, run inside the container (its port is not published). It connects, asks
// for one full picture of the screen, and prints what it found as JSON.
import { Buffer } from "node:buffer";
import net from "node:net";
import process from "node:process";

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

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

const banner = (await read(12)).toString("latin1");
socket.write("RFB 003.008\n");
const [count] = await read(1);
const types = [...(await read(count))];
if (!types.includes(1)) throw new Error("no 'none' security type");
socket.write(Buffer.from([1]));
if ((await read(4)).readUInt32BE(0) !== 0) throw new Error("security refused");
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
print({ banner: banner.trim(), width, height, colours: colours.size });
socket.destroy();
process.exit(0);
