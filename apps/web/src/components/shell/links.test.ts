import { describe, expect, test } from "bun:test";
import { isActive } from "./links";

describe("isActive", () => {
  test("exact and nested paths", () => {
    expect(isActive("/log", "/log")).toBe(true);
    expect(isActive("/log/entry", "/log")).toBe(true);
  });
  test("prefix that is not a segment does not match", () => {
    expect(isActive("/logout", "/log")).toBe(false);
  });
  test("exact links match only themselves", () => {
    expect(isActive("/interview", "/interview", true)).toBe(true);
    expect(isActive("/interview/insights", "/interview", true)).toBe(false);
  });
  test("home matches only itself", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/ask", "/")).toBe(false);
  });
});
