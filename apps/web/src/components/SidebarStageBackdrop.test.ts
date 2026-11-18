import { describe, expect, it } from "vite-plus/test";

import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
} from "./SidebarStageBackdrop";

describe("resolveSidebarStageBackdropVariant", () => {
  it.each([
    ["Fork", "artwork", "fork"],
    ["Fork", "nightly-artwork", "nightly"],
    ["Fork", "dev-artwork", "dev"],
    ["Fork", "pill", null],
    ["Fork", "none", null],
    ["Nightly", "artwork", "nightly"],
    ["Dev", "artwork", "dev"],
    ["Latest", "artwork", null],
  ] as const)("shows %s in %s mode as %s", (stageLabel, mode, expected) => {
    expect(resolveSidebarStageBackdropVariant(stageLabel, mode)).toBe(expected);
  });
});

describe("resolveEnvironmentIdentificationPillLabel", () => {
  it.each([
    ["Fork", "Fork"],
    ["Nightly", "Nightly"],
    ["Dev", "Dev"],
    ["Latest", null],
  ])("labels the %s pill as %s", (stageLabel, expected) => {
    expect(resolveEnvironmentIdentificationPillLabel(stageLabel)).toBe(expected);
  });
});
