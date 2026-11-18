import { describe, expect, it } from "vitest";
import { loginAlertMail } from "./alert-email.js";

const notice = { supplierId: "11111111-1111-4111-8111-111111111111", supplierName: "Acme", message: "Acme is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it." };

describe("the login alert email", () => {
  it("names the supplier and links to its login page in the app", () => {
    expect(loginAlertMail(notice, "https://stock.example.com")).toEqual({
      subject: "Acme needs you to log in",
      text: "Acme is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it.\n\nLog in here: https://stock.example.com/suppliers/11111111-1111-4111-8111-111111111111/connect\n\nSent by Stock Monitor.",
    });
  });

  it("links to localhost when the app's address is not set", () => {
    expect(loginAlertMail(notice, undefined).text).toContain("Log in here: http://localhost:3000/suppliers/11111111-1111-4111-8111-111111111111/connect");
  });
});
