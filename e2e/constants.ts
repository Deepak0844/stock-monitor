export const PORT = 4173;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const OWNER_EMAIL = "owner@example.com";
export const OWNER_PASSWORD = "correct horse battery staple";

// The control channel the browser tests use to reset and steer the fake Shopify. Test stack only.
export const CONTROL_PORT = 4174;
export const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;

// What the fake Shopify store accepts, and what the browser tests type in.
export const SHOP = "e2e-store.myshopify.com";
export const SHOP_NAME = "E2E Store";
export const CLIENT_ID = "e2e-client-id-8a41";
export const CLIENT_SECRET = "e2e-client-secret-value-5d27";
export const ROTATED_SECRET = "e2e-rotated-secret-value-91c0";
