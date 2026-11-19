import { RegistryContext } from "@effect/atom-react";
import {
  createScopedSettingsWriter,
  type ScopedSettingsPlan,
} from "@t3tools/client-runtime/settings-writer";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ServerSettingsPatch } from "@t3tools/contracts";
import { use } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SettingsTarget } from "./settings-environment-filter";

type SettingsWrite = { readonly environmentId: EnvironmentId; readonly patch: ServerSettingsPatch };
type SettingsWriter = ReturnType<typeof createScopedSettingsWriter<SettingsTarget>>;

// One writer per registry, so every Settings screen's saves to an environment share one queue.
const writers = new WeakMap<object, SettingsWriter>();

export function useSettingsWriter() {
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "environment settings update",
    reportFailure: true,
  });
  const registry = use(RegistryContext);
  let writer = writers.get(registry);
  if (writer === undefined) {
    writer = createScopedSettingsWriter<SettingsTarget>(
      (environmentId) =>
        registry.get(environmentServerConfigsAtom).get(environmentId)?.settings ?? null,
    );
    writers.set(registry, writer);
  }
  const write = writer;

  /**
   * The server replaces a project's override entry whole, so each save is planned again from the
   * newest settings this device holds when it starts, the previous save's response included.
   * Resolves to the environments that did not save, interrupted ones included.
   */
  return async (
    environments: readonly SettingsTarget[],
    plan: (environments: readonly SettingsTarget[]) => readonly SettingsWrite[],
  ) => {
    // A single-key write, such as hiding a pull request, may name an environment it was not given.
    const unknown = new Set<EnvironmentId>();
    const toPlan = (current: readonly SettingsTarget[]): ScopedSettingsPlan => ({
      clientPatch: {},
      hasClientWrite: false,
      unavailableReason: null,
      serverWrites: plan(current).flatMap((entry) => {
        const environment = current.find(
          (candidate) => candidate.environmentId === entry.environmentId,
        );
        const previous =
          environment?.serverConfig.settings ??
          registry.get(environmentServerConfigsAtom).get(entry.environmentId)?.settings;
        if (previous === undefined) {
          unknown.add(entry.environmentId);
          return [];
        }
        return [
          {
            environmentId: entry.environmentId,
            label: environment?.label ?? entry.environmentId,
            patch: entry.patch,
            previous,
          },
        ];
      }),
    });
    const interrupted = new Set<EnvironmentId>();
    const { failedEnvironments } = await write(
      environments,
      toPlan,
      async (request) => {
        const result = await updateSettings(request);
        if (isAtomCommandInterrupted(result)) interrupted.add(request.environmentId);
        return result;
      },
      () => {},
    );
    const failures = failedEnvironments.flatMap((failure) =>
      interrupted.has(failure.environmentId) ? [] : [`${failure.label}: ${failure.message}`],
    );
    if (failures.length > 0) {
      Dialog.alert("Could not save settings", failures.join("\n\n"));
    }
    return [...failedEnvironments.map((failure) => failure.environmentId), ...unknown];
  };
}
