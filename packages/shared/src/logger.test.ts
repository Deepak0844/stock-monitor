import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "./logger.js";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe("createLogger", () => {
  it("does not output a fake password, token or cookie", () => {
    const { lines, stream } = capture();
    const log = createLogger({ level: "info", stream });
    log.info({ password: "P@ssw0rd-x", sessionToken: "TOKEN-x", cookie: "COOKIE-x" }, "login");
    const out = lines.join("");
    expect(out).not.toContain("P@ssw0rd-x");
    expect(out).not.toContain("TOKEN-x");
    expect(out).not.toContain("COOKIE-x");
  });

  it("redacts authorization and cookie headers on request objects", () => {
    const { lines, stream } = capture();
    const log = createLogger({ level: "info", stream });
    log.info({ req: { headers: { authorization: "Bearer AUTH-x", cookie: "sid=COOKIE-y" } } }, "req");
    const out = lines.join("");
    expect(out).not.toContain("AUTH-x");
    expect(out).not.toContain("COOKIE-y");
  });

  it("still logs the message and non-secret fields", () => {
    const { lines, stream } = capture();
    const log = createLogger({ level: "info", stream });
    log.info({ supplier: "acme" }, "check started");
    const out = lines.join("");
    expect(out).toContain("check started");
    expect(out).toContain("acme");
  });
});
