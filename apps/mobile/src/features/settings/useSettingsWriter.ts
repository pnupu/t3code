import { RegistryContext } from "@effect/atom-react";
import { useGT } from "gt-react-native";
import type { EnvironmentId, ServerSettingsPatch } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { use } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import * as Dialog from "../../components/ui/Dialog";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  settlePendingMobileSettingsWrites,
  type PendingMobileSettingsWrite,
  type ScopedMobileSettingsTarget,
} from "./settings-scoped-server";

/** Saves the cache has not shown yet; plans read them through `withPendingMobileSettingsWrites`. */
export const pendingMobileSettingsWritesAtom = Atom.make<readonly PendingMobileSettingsWrite[]>(
  [],
).pipe(Atom.keepAlive, Atom.withLabel("mobile-settings:pending-writes"));

export function useSettingsWriter() {
  const gt = useGT();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "environment settings update",
    reportFailure: true,
  });
  const registry = use(RegistryContext);
  const settle = (
    update: (writes: readonly PendingMobileSettingsWrite[]) => PendingMobileSettingsWrite[],
  ) => {
    const configs = registry.get(environmentServerConfigsAtom);
    registry.set(
      pendingMobileSettingsWritesAtom,
      settlePendingMobileSettingsWrites(
        update([...registry.get(pendingMobileSettingsWritesAtom)]),
        (id) => configs.get(id)?.settings,
      ),
    );
  };

  /** Resolves to the environments that did not save, interrupted ones included. */
  return async (
    targets: readonly ScopedMobileSettingsTarget[],
    writes: readonly {
      readonly environmentId: EnvironmentId;
      readonly patch: ServerSettingsPatch;
    }[],
  ) => {
    const failed: EnvironmentId[] = [];
    const cachedAtSend = registry.get(environmentServerConfigsAtom);
    const sent = writes.map((entry) => ({ save: {}, ...entry }));
    settle((pending) => [...pending, ...sent]);
    const outcomes = await Promise.all(
      writes.map(async (entry, index) => {
        const result = await updateSettings({
          environmentId: entry.environmentId,
          input: { patch: entry.patch },
        });
        // A push since the send carries what the server stored, so the cache answers the save.
        // An interrupted save may still have landed, so it waits for that push like a success.
        const repliedOver = registry
          .get(environmentServerConfigsAtom)
          .get(entry.environmentId)?.settings;
        const answered =
          (result._tag === "Failure" && !isAtomCommandInterrupted(result)) ||
          repliedOver !== cachedAtSend.get(entry.environmentId)?.settings;
        settle((pending) =>
          pending.flatMap((write) =>
            write.save !== sent[index]!.save
              ? [write]
              : answered
                ? []
                : [{ ...write, repliedOver }],
          ),
        );
        if (result._tag === "Failure") failed.push(entry.environmentId);
        if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
        const label =
          targets.find((target) => target.environment.environmentId === entry.environmentId)
            ?.environment.label ?? entry.environmentId;
        const error = squashAtomCommandFailure(result);
        return gt("{environment}: {error}", {
          environment: label,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    );
    const failures = outcomes.filter((outcome) => outcome !== null);
    if (failures.length > 0) {
      Dialog.alert(gt("Could not save settings"), failures.join("\n\n"));
    }
    return failed;
  };
}
