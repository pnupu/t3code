import type {
  ClientSettingsPatch,
  EnvironmentId,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import type { EnvironmentConnectionPhase } from "./connection/index.ts";
import { errorDisplayMessage } from "./errors/translatable.ts";
import * as Equal from "effect/Equal";

/** One environment's server patch, with the settings it was planned from. */
export interface ScopedServerWrite {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly patch: ServerSettingsPatch;
  readonly previous: ServerSettings;
}

export interface ScopedSettingsPlan {
  readonly clientPatch: ClientSettingsPatch;
  readonly hasClientWrite: boolean;
  readonly serverWrites: readonly ScopedServerWrite[];
  readonly unavailableReason: string | null;
}

export interface ScopedSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: { readonly settings: ServerSettings } | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeWasDropped(value: unknown, before: unknown, saved: unknown): boolean {
  if (value === null) return before != null && Equal.equals(saved, before);
  if (isPlainObject(value) && !Array.isArray(before) && !Array.isArray(saved)) {
    const field = (source: unknown, key: string) =>
      isPlainObject(source) ? source[key] : undefined;
    return Object.entries(value).some(([key, next]) =>
      writeWasDropped(next, field(before, key), field(saved, key)),
    );
  }
  const unchanged =
    typeof value === "string" && typeof before === "string"
      ? value.trim() === before
      : Equal.equals(value, before);
  return !unchanged && Equal.equals(saved, before);
}

/** Older servers silently drop unknown keys; report them so rows cannot stay mixed forever. */
function droppedSettingKeys(write: ScopedServerWrite, saved: ServerSettings | undefined) {
  if (saved === undefined) return [];
  return Object.entries(write.patch).flatMap(([key, value]) =>
    writeWasDropped(
      value,
      write.previous[key as keyof ServerSettings],
      saved[key as keyof ServerSettings],
    )
      ? [key]
      : [],
  );
}

type ScopedSettingsPersistServer = (input: {
  environmentId: EnvironmentId;
  input: { patch: ServerSettingsPatch };
}) => Promise<{
  readonly _tag: "Success" | "Failure";
  readonly cause?: Cause.Cause<unknown>;
  readonly value?: ServerSettings;
}>;

export async function persistScopedSettingsPatch(
  plan: ScopedSettingsPlan,
  persistServer: ScopedSettingsPersistServer,
  persistClient: (patch: ClientSettingsPatch) => void,
  resolve: MFunctionType = mFallback,
) {
  return persistScopedSettingsPlan(
    plan,
    async (write) => ({
      write,
      result: await persistServer({
        environmentId: write.environmentId,
        input: { patch: write.patch },
      }),
    }),
    persistClient,
    resolve,
  );
}

const OWN_ECHO_LIMIT = 8;

/**
 * Project overrides are whole entries built from this client's copy of the settings, and that
 * copy hears about a save only when the server pushes it back. So saves to one environment run
 * one at a time, each planned as it starts from the newest settings this client holds: the
 * previous save's response, unless an independently changed copy has arrived.
 */
export function createScopedSettingsWriter<
  Environment extends ScopedSettingsEnvironment = ScopedSettingsEnvironment,
>(
  readSettings: (environmentId: EnvironmentId) => ServerSettings | null,
  resolve: MFunctionType = mFallback,
) {
  const queues = new Map<EnvironmentId, Promise<unknown>>();
  const responses = new Map<
    EnvironmentId,
    {
      readonly settings: ServerSettings;
      readonly copy: ServerSettings;
      readonly saved: readonly ServerSettings[];
    }
  >();
  return (
    environments: readonly Environment[],
    plan: (environments: readonly Environment[]) => ScopedSettingsPlan,
    persistServer: ScopedSettingsPersistServer,
    persistClient: (patch: ClientSettingsPatch) => void,
  ) =>
    persistScopedSettingsPlan(
      plan(environments),
      (planned) => {
        const { environmentId } = planned;
        const save = (queues.get(environmentId) ?? Promise.resolve()).then(async () => {
          const copy = readSettings(environmentId);
          const response = responses.get(environmentId);
          // A copy equal to one of our earlier responses is a delayed echo, older than the latest.
          const isOwnEcho = (settings: ServerSettings) =>
            response?.saved.some((saved) => Equal.equals(saved, settings)) === true;
          const continues =
            copy !== null && response !== undefined && (response.copy === copy || isOwnEcho(copy));
          const settings = continues ? response.settings : copy;
          const replanned =
            settings === null ? null : plan(withSettings(environments, environmentId, settings));
          const write =
            replanned?.serverWrites.find((next) => next.environmentId === environmentId) ?? planned;
          const result = await persistServer({ environmentId, input: { patch: write.patch } });
          const savedCopy = readSettings(environmentId);
          if (result._tag === "Success" && result.value !== undefined && savedCopy !== null) {
            // A changed copy may be a newer remote push or the delayed echo of our previous save.
            if (
              savedCopy === copy ||
              Equal.equals(savedCopy, settings) ||
              Equal.equals(savedCopy, result.value) ||
              isOwnEcho(savedCopy)
            ) {
              responses.set(environmentId, {
                settings: result.value,
                copy: savedCopy,
                saved: [...(continues ? response.saved : []), result.value].slice(-OWN_ECHO_LIMIT),
              });
            } else {
              responses.delete(environmentId);
            }
          }
          return { write, result };
        });
        queues.set(
          environmentId,
          save.catch(() => undefined),
        );
        return save;
      },
      persistClient,
      resolve,
    );
}

function withSettings<Environment extends ScopedSettingsEnvironment>(
  environments: readonly Environment[],
  environmentId: EnvironmentId,
  settings: ServerSettings,
): readonly Environment[] {
  return environments.map((environment) =>
    environment.environmentId === environmentId && environment.serverConfig
      ? { ...environment, serverConfig: { ...environment.serverConfig, settings } }
      : environment,
  );
}

async function persistScopedSettingsPlan(
  plan: ScopedSettingsPlan,
  persistWrite: (write: ScopedServerWrite) => Promise<{
    readonly write: ScopedServerWrite;
    readonly result: Awaited<ReturnType<ScopedSettingsPersistServer>>;
  }>,
  persistClient: (patch: ClientSettingsPatch) => void,
  resolve: MFunctionType,
) {
  if (plan.hasClientWrite) persistClient(plan.clientPatch);
  const results = await Promise.allSettled(plan.serverWrites.map(persistWrite));
  // A queued write is replanned before it is sent, so judge the write that was sent.
  const writes = results.map((result, index) =>
    result.status === "fulfilled" ? result.value.write : plan.serverWrites[index]!,
  );
  const saved = (index: number) => {
    const result = results[index];
    return (
      result?.status === "fulfilled" &&
      result.value.result._tag === "Success" &&
      droppedSettingKeys(writes[index]!, result.value.result.value).length === 0
    );
  };
  const failedEnvironments = writes.flatMap((environment, index) => {
    if (saved(index)) return [];
    const result = results[index];
    if (result?.status === "fulfilled" && result.value.result._tag === "Success") {
      return [
        {
          ...environment,
          message: resolve(
            msg("This environment does not support this setting. Update T3 Code on it."),
          ),
        },
      ];
    }
    const error: unknown =
      result?.status === "rejected"
        ? result.reason
        : result?.status === "fulfilled" && result.value.result.cause
          ? Cause.squash(result.value.result.cause)
          : undefined;
    return [
      {
        ...environment,
        message:
          error instanceof Error
            ? (errorDisplayMessage(error, resolve) ?? error.message)
            : resolve(msg("The save failed. Try reconnecting and saving again.")),
      },
    ];
  });
  const savedEnvironments = writes.filter((_, index) => saved(index));
  return {
    failedEnvironments,
    savedEnvironments,
    savedEnvironmentCount: savedEnvironments.length,
  };
}
