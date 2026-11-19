import { describe, expect, it, vi } from "vite-plus/test";

import type { ScopedThreadRef } from "@t3tools/contracts";

import {
  type InAppLinkTarget,
  type LinkTargetSettings,
  previewRuntimeForLinkTarget,
  resolveLinkTarget,
} from "./browserLinkTarget";

const runtime = vi.hoisted(() => ({ desktop: true, serverBrowser: true, primary: "local" }));

vi.mock("~/hooks/useSettings", () => ({
  ensureClientSettingsHydrated: vi.fn(async () => undefined),
  getClientSettings: () => ({}),
}));
vi.mock("~/previewStateStore", () => ({ isPreviewSupportedInRuntime: () => runtime.desktop }));
vi.mock("~/state/entities", () => ({
  readEnvironmentSupportsServerBrowser: () => runtime.serverBrowser,
}));
vi.mock("~/state/primaryEnvironment", () => ({ primaryEnvironmentIdAtom: "primary" }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => runtime.primary } }));
vi.mock("~/state/session", () => ({ readEnvironmentScope: () => true }));
vi.mock("./previewRuntime", () => ({
  isPreviewAvailableFor: () => true,
  previewRuntimeFor: () => (runtime.serverBrowser ? "server" : undefined),
}));

const click = { metaKey: false, ctrlKey: false };
const settings: LinkTargetSettings = {
  browserLinkTarget: "app",
  browserModClickLinkTarget: "local",
  browserModShiftClickLinkTarget: "environment",
};
const url = "https://example.com/";

describe("resolveLinkTarget", () => {
  it("leaves non-web schemes to the shell", () => {
    for (const url of ["mailto:someone@example.com", "vscode://file/x", "not a url"]) {
      expect(resolveLinkTarget({ url, event: click, settings, canOpenIn: () => true })).toBe(
        "system",
      );
    }
  });

  it.each([
    { event: click, expected: "app" },
    { event: { metaKey: true, ctrlKey: false }, expected: "local" },
    { event: { metaKey: false, ctrlKey: true }, expected: "local" },
    { event: { metaKey: true, ctrlKey: false, shiftKey: true }, expected: "environment" },
    { event: { metaKey: false, ctrlKey: true, shiftKey: true }, expected: "environment" },
    { event: { metaKey: false, ctrlKey: false, shiftKey: true }, expected: "app" },
    { event: { metaKey: true, ctrlKey: false, button: 1 }, expected: "system" },
    { event: { metaKey: true, ctrlKey: false, altKey: true }, expected: "system" },
  ])("picks the setting for $event", ({ event, expected }) => {
    expect(resolveLinkTarget({ url, event, settings, canOpenIn: () => true })).toBe(expected);
  });

  it("opens the system browser when the picked browser is unavailable or system", () => {
    const canOpenIn = (target: InAppLinkTarget) => target !== "local";
    const modClick = { metaKey: true, ctrlKey: false };
    expect(resolveLinkTarget({ url, event: modClick, settings, canOpenIn })).toBe("system");
    expect(
      resolveLinkTarget({
        url,
        event: { ...modClick, shiftKey: true },
        settings: { ...settings, browserModShiftClickLinkTarget: "system" },
        canOpenIn,
      }),
    ).toBe("system");
  });
});

describe("previewRuntimeForLinkTarget", () => {
  const threadOn = (environmentId: string) =>
    ({ environmentId, threadId: "thread-1" }) as unknown as ScopedThreadRef;

  it.each([
    // A remote thread: "local" is a desktop tab here, "environment" a server tab there.
    { env: "remote", desktop: true, serverBrowser: true, target: "local", expected: undefined },
    {
      env: "remote",
      desktop: true,
      serverBrowser: true,
      target: "environment",
      expected: "server",
    },
    { env: "remote", desktop: false, serverBrowser: true, target: "local", expected: null },
    { env: "remote", desktop: true, serverBrowser: false, target: "environment", expected: null },
    // The primary environment is this machine, so both targets keep its usual runtime.
    { env: "local", desktop: true, serverBrowser: true, target: "local", expected: "server" },
    {
      env: "local",
      desktop: true,
      serverBrowser: false,
      target: "environment",
      expected: undefined,
    },
  ] as const)(
    "$target on $env (desktop: $desktop, server browser: $serverBrowser)",
    ({ env, desktop, serverBrowser, target, expected }) => {
      runtime.desktop = desktop;
      runtime.serverBrowser = serverBrowser;
      expect(previewRuntimeForLinkTarget(threadOn(env), target)).toBe(expected);
    },
  );
});
