// A stand-in VNC server for browser tests. It speaks just enough of the real protocol (version 3.8, the
// password login, one raw picture of a login page) for noVNC to connect and draw it, so the real viewer, the
// real WebSocket proxy and the real page are all tested. It accepts any password, and ignores keys and mouse.
import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

const WIDTH = 640;
const HEIGHT = 400;

/** A plain picture of a login page: a dark bar, a card, two boxes and a green button. 32 bits a pixel. noVNC asks for red first, and this server does not read that request, so it simply sends that order. */
function picture(): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, [r, g, b]: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.set([r, g, b, 0], (y * WIDTH + x) * 4);
  };
  fill(0, 0, WIDTH, HEIGHT, [241, 245, 249]);
  fill(0, 0, WIDTH, 48, [31, 41, 55]);
  fill(170, 90, 470, 340, [255, 255, 255]);
  fill(190, 150, 450, 190, [226, 232, 240]);
  fill(190, 210, 450, 250, [226, 232, 240]);
  fill(190, 280, 450, 320, [4, 120, 87]);
  return pixels;
}

export type FakeVnc = { port: number; close(): Promise<void> };

export async function startFakeVnc(): Promise<FakeVnc> {
  const frame = picture();
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());

    let buffer = Buffer.alloc(0);
    let wake: (() => void) | null = null;
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      wake?.();
    });
    const read = async (n: number): Promise<Buffer> => {
      while (buffer.length < n) {
        if (socket.destroyed) throw new Error("closed");
        await new Promise<void>((resolve) => (wake = resolve));
      }
      const out = buffer.subarray(0, n);
      buffer = buffer.subarray(n);
      return out;
    };

    void (async () => {
      socket.write("RFB 003.008\n");
      await read(12); // the client's version
      socket.write(Buffer.from([1, 2])); // one way to log in: a password
      await read(1);
      socket.write(randomBytes(16)); // the challenge
      await read(16); // any answer is accepted
      socket.write(Buffer.alloc(4)); // login succeeded
      await read(1); // ClientInit

      const init = Buffer.alloc(24);
      init.writeUInt16BE(WIDTH, 0);
      init.writeUInt16BE(HEIGHT, 2);
      init[4] = 32; // bits per pixel
      init[5] = 24; // depth
      init[7] = 1; // true colour
      init.writeUInt16BE(255, 8);
      init.writeUInt16BE(255, 10);
      init.writeUInt16BE(255, 12);
      init[14] = 16; // red shift
      init[15] = 8; // green shift
      init[16] = 0; // blue shift
      const name = Buffer.from("fake supplier login");
      init.writeUInt32BE(name.length, 20);
      socket.write(Buffer.concat([init, name]));

      for (;;) {
        const [type] = await read(1);
        if (type === 0) await read(19); // SetPixelFormat
        else if (type === 2) {
          const head = await read(3);
          await read(head.readUInt16BE(1) * 4); // SetEncodings
        } else if (type === 3) {
          const request = await read(9);
          if (request[0] === 0) {
            // A full request: send the whole picture as one raw rectangle.
            const header = Buffer.alloc(16);
            header[0] = 0;
            header.writeUInt16BE(1, 2);
            header.writeUInt16BE(WIDTH, 8);
            header.writeUInt16BE(HEIGHT, 10);
            socket.write(Buffer.concat([header, frame]));
          }
        } else if (type === 4) await read(7); // key
        else if (type === 5) await read(5); // mouse
        else if (type === 6) {
          const head = await read(7);
          await read(head.readUInt32BE(3)); // pasted text
        } else throw new Error(`unexpected message ${type}`);
      }
    })().catch(() => socket.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
