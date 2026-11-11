// Page tests see toasts the way the owner does: one Toaster on the page. It is mounted once per test file and emptied after each test.
import { afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { Toaster } from "../components/ui/toaster.js";
import { clearToasts } from "../lib/toast.js";

if (typeof document !== "undefined") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  host.id = "toast-host";
  document.body.appendChild(host);
  act(() => createRoot(host).render(<Toaster />));
  afterEach(() => act(() => clearToasts()));
}
