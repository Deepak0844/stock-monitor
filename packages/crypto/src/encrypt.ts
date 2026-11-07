import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { assertKey } from "./key.js";

export type Encrypted = { ciphertext: string; iv: string; tag: string; keyId: string };

export function encrypt(plaintext: string, key: Buffer, keyId: string): Encrypted {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyId,
  };
}

export function decrypt(enc: Encrypted, key: Buffer): string {
  assertKey(key);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
