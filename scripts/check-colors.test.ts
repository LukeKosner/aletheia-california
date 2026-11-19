import { expect, test } from "bun:test";
import { findRawColors } from "./check-colors";

test("flags hex and rgb colors", () => {
  expect(findRawColors("color: #fff;").length).toBe(1);
  expect(findRawColors("bg-[#383838]").length).toBe(1);
  expect(findRawColors("linear-gradient(#0000_calc(50%))").length).toBe(1);
  expect(findRawColors("color: rgb(0 0 0)").length).toBe(1);
  expect(findRawColors("color: rgba(0,0,0,.5)").length).toBe(1);
});

test("allows tokens and non-color hashes", () => {
  expect(findRawColors("text-muted-foreground bg-background").length).toBe(0);
  expect(findRawColors("--primary: oklch(0.2 0.01 322)").length).toBe(0);
  expect(findRawColors("&#123; id=#section-1").length).toBe(0);
});
