import { describe, expect, it } from "vite-plus/test";

import {
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.logic";

describe("resolveServerBackedAppStageLabel", () => {
  it.each([
    ["0.1.9001", "Fork"],
    ["0.1.1000", "Fork"],
    ["12.3.14027", "Fork"],
    ["0.1.9", "Beta"],
    ["0.1.999", "Beta"],
    ["0.1.9001-rc.1", "Beta"],
    ["0.1.10-nightly.20261118.1", "Nightly"],
    ["0.1.9001-nightly.20261118.1", "Nightly"],
    [null, "Beta"],
  ])("labels server version %s as %s", (primaryServerVersion, expected) => {
    expect(
      resolveServerBackedAppStageLabel({ primaryServerVersion, fallbackStageLabel: "Beta" }),
    ).toBe(expected);
  });
});

describe("resolveServerBackedAppDisplayName", () => {
  it.each([
    ["0.1.9001", "T3 Code (Fork)"],
    ["0.1.10-nightly.20261118.1", "T3 Code (Nightly)"],
    ["0.1.9", "T3 Code (Beta)"],
  ])("names the app for server version %s as %s", (primaryServerVersion, expected) => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Code",
        fallbackDisplayName: "T3 Code (Beta)",
        fallbackStageLabel: "Beta",
        primaryServerVersion,
      }),
    ).toBe(expected);
  });
});
