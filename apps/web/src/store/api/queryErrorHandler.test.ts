import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../api.js";
import { clearToasts, getToasts } from "../../lib/toast.js";
import { handleQueryError } from "./queryErrorHandler.js";

afterEach(clearToasts);
const failure = new ApiError("Can't reach the server. Check your connection and try again.", 0);

describe("handleQueryError", () => {
  it("shows nothing by default, because pages show their own errors", () => {
    handleQueryError(failure, undefined);
    handleQueryError(failure, {});
    expect(getToasts()).toEqual([]);
  });

  it("shows the server's message as an error toast when the endpoint asks for it", () => {
    handleQueryError(failure, { showToaster: true });
    expect(getToasts().map((t) => [t.text, t.kind])).toEqual([[failure.message, "error"]]);
  });

  it("shows nothing when the error is suppressed, even if a toast was asked for", () => {
    handleQueryError(failure, { showToaster: true, suppressGlobalError: true });
    expect(getToasts()).toEqual([]);
  });

  it("uses a plain sentence for an error that is not from the server", () => {
    handleQueryError("boom", { showToaster: true });
    expect(getToasts().map((t) => t.text)).toEqual(["Something went wrong. Please try again."]);
  });
});
