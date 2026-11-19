import { describe, expect, it } from "vitest";
import type { LoginInspection } from "../api.js";
import { candidatesFor, selectorsFromPicks, startingPicks, type Role } from "./loginPicks.js";

const c = (label: string, selector: string) => ({ label, selector });
const inspection = (over: Partial<LoginInspection> = {}): LoginInspection => ({
  state: "form",
  opened: false,
  found: { open: null, account: null, username: c("Email", "#UserName"), password: c("Password", "#Password"), submit: c("login to your account", "#dupbtn") },
  fields: [c("Email", "#UserName"), c("Password", "#Password"), c("Search", 'input[name="q"]')],
  buttons: [c("login to your account", "#dupbtn"), c("Forgot password", 'a:text-is("Forgot password")')],
  ...over,
});
const all = (pick: string): Record<Role, string> => ({ open: pick, account: pick, username: pick, password: pick, submit: pick });

describe("selectorsFromPicks", () => {
  it("keeps only the picks that carry a selector", () => {
    expect(selectorsFromPicks({ ...all("auto"), username: "#UserName", submit: "none", password: "saved:#Pw" })).toEqual({ username: "#UserName", password: "#Pw" });
  });
  it("is null when nothing is picked", () => {
    expect(selectorsFromPicks(all("auto"))).toBeNull();
    expect(selectorsFromPicks(all("none"))).toBeNull();
  });
});

describe("candidatesFor", () => {
  it("lists boxes for the box roles and buttons for the button roles, each once", () => {
    expect(candidatesFor(inspection(), "username").map((x) => x.label)).toEqual(["Email", "Password", "Search"]);
    expect(candidatesFor(inspection(), "submit").map((x) => x.label)).toEqual(["login to your account", "Forgot password"]);
    expect(candidatesFor(inspection(), "open").map((x) => x.selector)).toEqual(["#dupbtn", 'a:text-is("Forgot password")']);
  });
  it("adds the found control when the lists do not hold it", () => {
    const i = inspection({ found: { ...inspection().found, open: c("Customer login", "#cl") } });
    expect(candidatesFor(i, "open")[0]).toEqual(c("Customer login", "#cl"));
  });
});

describe("startingPicks", () => {
  it("starts on automatic when nothing is saved", () => {
    expect(startingPicks(null, inspection())).toEqual(all("auto"));
    expect(startingPicks(undefined, inspection())).toEqual(all("auto"));
  });
  it("keeps a saved selector that is a candidate", () => {
    expect(startingPicks({ username: "#UserName" }, inspection()).username).toBe("#UserName");
  });
  it("keeps a saved selector that is not a candidate as saved", () => {
    expect(startingPicks({ password: "#old-pw" }, inspection()).password).toBe("saved:#old-pw");
  });
});
