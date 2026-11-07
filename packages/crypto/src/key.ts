const KEY_BYTES = 32;

// The only place the encryption key is read. Swap this for a secret manager later.
export function loadKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error("APP_ENCRYPTION_KEY is not set");
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`APP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes`);
  }
  return key;
}

export function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error(`Encryption key must be ${KEY_BYTES} bytes`);
}
