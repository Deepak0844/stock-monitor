// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ApiError } from "../../api.js";
import { aCheck } from "../../test/fake-api.js";
import { ShopifyConnectForm } from "./ShopifyConnectForm.js";

afterEach(cleanup);

const setup = (over: Partial<Parameters<typeof ShopifyConnectForm>[0]> = {}) => {
  const onTest = vi.fn().mockResolvedValue(aCheck());
  const onConnect = vi.fn().mockResolvedValue(undefined);
  render(<ShopifyConnectForm onTest={onTest} onConnect={onConnect} {...over} />);
  return { onTest, onConnect, user: userEvent.setup() };
};

const fill = async (user: ReturnType<typeof userEvent.setup>, shop = "Acme.myshopify.com", id = "client-id-1", secret = "client-secret-1") => {
  await user.type(screen.getByLabelText("Store address"), shop);
  await user.type(screen.getByLabelText("Client ID"), id);
  await user.type(screen.getByLabelText("Client secret"), secret);
};

describe("fields", () => {
  it("has labelled fields, a hint about the address, and both buttons", () => {
    setup();
    expect(screen.getByLabelText("Store address")).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client secret")).toBeInTheDocument();
    expect(screen.getByText(/like my-store\.myshopify\.com/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("keeps the secret hidden and out of autofill", () => {
    setup();
    const secret = screen.getByLabelText("Client secret");
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).toHaveAttribute("autocomplete", "off");
  });

  it("can start with the store address filled in, but never the client id or secret", () => {
    setup({ initialShop: "acme.myshopify.com" });
    expect(screen.getByLabelText("Store address")).toHaveValue("acme.myshopify.com");
    expect(screen.getByLabelText("Client ID")).toHaveValue("");
    expect(screen.getByLabelText("Client secret")).toHaveValue("");
  });
});

describe("checking what was typed", () => {
  it("explains each empty field beside it, moves focus to the first, and sends nothing", async () => {
    const { onTest, onConnect, user } = setup();
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Enter your store address, like my-store.myshopify.com.")).toBeInTheDocument();
    expect(screen.getByText("Enter the client ID.")).toBeInTheDocument();
    expect(screen.getByText("Enter the client secret.")).toBeInTheDocument();
    expect(screen.getByLabelText("Store address")).toHaveFocus();
    expect(screen.getByLabelText("Store address")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Store address")).toHaveAccessibleDescription(/enter your store address/i);
    expect(onTest).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("checks the fields before testing too", async () => {
    const { onTest, user } = setup();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(screen.getByText("Enter the client secret.")).toBeInTheDocument();
    expect(onTest).not.toHaveBeenCalled();
  });

  it("clears a field's message once it has been fixed and the form is sent again", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.queryByText("Enter the client ID.")).not.toBeInTheDocument();
  });
});

describe("test connection", () => {
  it("sends the trimmed details and shows what Shopify said", async () => {
    const { onTest, user } = setup();
    await fill(user, "  acme.myshopify.com ", " client-id-1 ", "client-secret-1");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(onTest).toHaveBeenCalledWith({ shop: "acme.myshopify.com", clientId: "client-id-1", clientSecret: "client-secret-1" });
    expect(await screen.findByText(/connection works/i)).toBeInTheDocument();
    expect(screen.getByText(/Acme Supplies/)).toBeInTheDocument();
  });

  it("lists every warning in plain words", async () => {
    const warnings = [
      "This connection can change your store (write_inventory). This app only needs to read, so for extra safety remove the write permissions in Shopify.",
      "We could not check which permissions this connection has.",
    ];
    const { user } = setup({ onTest: vi.fn().mockResolvedValue(aCheck({ warnings })) });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    for (const w of warnings) expect(await screen.findByText(w)).toBeInTheDocument();
  });

  it("keeps what was typed, so the owner can go straight on to Connect", async () => {
    const { user } = setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(/connection works/i);
    expect(screen.getByLabelText("Client secret")).toHaveValue("client-secret-1");
  });
});

describe("connect", () => {
  it("sends the details, and clears the secret and client id afterwards", async () => {
    const { onConnect, user } = setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith({ shop: "acme.myshopify.com", clientId: "client-id-1", clientSecret: "client-secret-1" }));
    await waitFor(() => expect(screen.getByLabelText("Client secret")).toHaveValue(""));
    expect(screen.getByLabelText("Client ID")).toHaveValue("");
  });

  it("keeps what was typed when connecting fails, so it can be corrected", async () => {
    const onConnect = vi.fn().mockRejectedValue(new ApiError("Shopify rejected the saved connection. Reconnect Shopify.", 422, "shopify_rejected_credentials"));
    const { user } = setup({ onConnect });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Shopify rejected the saved connection. Reconnect Shopify.");
    expect(screen.getByLabelText("Client ID")).toHaveValue("client-id-1");
  });

  it("puts a bad store address message beside the store field", async () => {
    const onConnect = vi.fn().mockRejectedValue(new ApiError("Enter your store address, like my-store.myshopify.com.", 400, "invalid_shop"));
    const { user } = setup({ onConnect });
    await fill(user, "evil.com");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const field = screen.getByLabelText("Store address");
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveAccessibleDescription(/enter your store address/i);
    expect(field).toHaveFocus();
  });

  it("shows the different-organization message as it is", async () => {
    const message = "Shopify says this app and your store belong to different organizations. Create the app in the same organization as your store.";
    const { user } = setup({ onTest: vi.fn().mockRejectedValue(new ApiError(message, 422, "shopify_wrong_organization")) });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("never repeats the secret in a message", async () => {
    const { user } = setup({ onConnect: vi.fn().mockRejectedValue(new ApiError("Can't reach Shopify right now. Try again in a few minutes.", 503, "shopify_unreachable")) });
    await fill(user, "acme.myshopify.com", "client-id-1", "TOP-SECRET-VALUE");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("TOP-SECRET-VALUE");
  });

  it("shows progress and blocks a second click while working", async () => {
    let finish!: () => void;
    const onConnect = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = setup({ onConnect });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const busy = await screen.findByRole("button", { name: "Connecting…" });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled());
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});

describe("older permanent token", () => {
  it("swaps the client id and secret for an access token", async () => {
    const { onConnect, user } = setup();
    await user.click(screen.getByRole("button", { name: /use an older permanent access token/i }));
    expect(screen.queryByLabelText("Client ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Client secret")).not.toBeInTheDocument();
    const token = screen.getByLabelText("Access token");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("autocomplete", "off");

    await user.type(screen.getByLabelText("Store address"), "acme.myshopify.com");
    await user.type(token, "legacy-token-1");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith({ shop: "acme.myshopify.com", accessToken: "legacy-token-1" }));
  });

  it("asks for the token when it is missing, and can go back to the client id and secret", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /use an older permanent access token/i }));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Enter the access token.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /use a client id and secret instead/i }));
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
  });
});
