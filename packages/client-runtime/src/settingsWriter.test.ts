import { describe, expect, it, vi } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";

import { createScopedSettingsWriter, type ScopedSettingsPlan } from "./settingsWriter.ts";

const environmentId = EnvironmentId.make("server");
const projectId = ProjectId.make("web");

describe("scoped settings writer", () => {
  it("plans an empty save again from the save before it, and sends it only if it then changes something", async () => {
    const copy: ServerSettings = { ...DEFAULT_SERVER_SETTINGS, projectSettingsOverrides: {} };
    let stored = copy;
    const persistServer = vi.fn(async ({ input }: { input: { patch: ServerSettingsPatch } }) => {
      stored = applyServerSettingsPatch(stored, input.patch);
      return { _tag: "Success" as const, value: stored };
    });
    const environment = {
      environmentId,
      label: "Server",
      connection: { phase: "connected" as const },
      serverConfig: { settings: copy },
    };
    // No config push arrives, so the client's copy stays as it was before the first save.
    const write = createScopedSettingsWriter<typeof environment>(() => copy);
    const plan =
      (patchFor: (settings: ServerSettings) => ServerSettingsPatch) =>
      (environments: ReadonlyArray<typeof environment>): ScopedSettingsPlan => ({
        clientPatch: {},
        hasClientWrite: false,
        unavailableReason: null,
        serverWrites: environments.map((candidate) => ({
          environmentId,
          label: candidate.label,
          previous: candidate.serverConfig.settings,
          patch: patchFor(candidate.serverConfig.settings),
        })),
      });
    const clearFeedRule = plan((settings) =>
      settings.projectSettingsOverrides[projectId]?.pullRequestFeed === undefined
        ? {}
        : { projectSettingsOverrides: { [projectId]: null } },
    );

    await write([environment], clearFeedRule, persistServer, vi.fn());
    expect(persistServer).not.toHaveBeenCalled();

    await Promise.all([
      write(
        [environment],
        plan(() => ({ projectSettingsOverrides: { [projectId]: { pullRequestFeed: "hidden" } } })),
        persistServer,
        vi.fn(),
      ),
      write([environment], clearFeedRule, persistServer, vi.fn()),
    ]);
    expect(persistServer).toHaveBeenCalledTimes(2);
    expect(stored.projectSettingsOverrides[projectId]).toBeUndefined();
  });
});
