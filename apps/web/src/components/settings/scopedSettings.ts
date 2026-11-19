import {
  ClientSettingsSchema,
  type ClientSettingsPatch,
  type EnvironmentId,
  globalIdleCompaction,
  idleCompactionPatch,
  isNullableProjectSettingsOverride,
  readsIdleCompactionModes,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type ProjectId,
  type ProjectScopedServerSettingKey,
  type ProjectSettingsOverrides,
  ServerSettings,
  type T3ProjectFile,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  clearProjectSettingsOverrides,
  resolveProjectSettings,
  resolveWorktreeCleanup,
  type ProjectSettingSource,
} from "@t3tools/shared/projectSettings";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Equal from "effect/Equal";
import { Atom } from "effect/reactivity";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";

import type {
  ScopedServerWrite,
  ScopedSettingsEnvironment,
} from "@t3tools/client-runtime/settings-writer";

import type { ResolvedSettingsScope } from "./settingsScope";

export {
  createScopedSettingsWriter,
  persistScopedSettingsPatch,
} from "@t3tools/client-runtime/settings-writer";

export type ScopedSettingsPatch = ServerSettingsPatch & ClientSettingsPatch;

const SERVER_KEYS = new Set<string>(Object.keys(ServerSettings.fields));
const CLIENT_KEYS = new Set<string>(Object.keys(ClientSettingsSchema.fields));
const PROJECT_SCOPED_KEYS = new Set<string>(PROJECT_SCOPED_SERVER_SETTING_KEYS);

export function isProjectScopedSettingKey(key: string): key is ProjectScopedServerSettingKey {
  return PROJECT_SCOPED_KEYS.has(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isConnectedWithConfig(
  environment: Pick<ScopedSettingsEnvironment, "connection" | "serverConfig">,
) {
  return environment.connection.phase === "connected" && environment.serverConfig !== null;
}

/**
 * A server save shown before its environment pushes the new settings back. It applies while in
 * flight, and after success only until that environment's settings change from `settledOver`.
 */
export interface PendingScopedWrite {
  readonly save: object;
  readonly environmentId: EnvironmentId;
  readonly patch: ServerSettingsPatch;
  readonly settledOver?: ServerSettings;
}

export const pendingScopedWritesAtom = Atom.make<readonly PendingScopedWrite[]>([]).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-settings:pending-scoped-writes"),
);

const pendingWriteApplies = (write: PendingScopedWrite, settings: ServerSettings | undefined) =>
  settings !== undefined && (write.settledOver === undefined || write.settledOver === settings);

/** Settles one environment's write: a failure or an already-pushed result drops it. */
export function settlePendingScopedWrites(
  writes: readonly PendingScopedWrite[],
  target: Pick<PendingScopedWrite, "save" | "environmentId">,
  readSettings: (environmentId: EnvironmentId) => ServerSettings | undefined,
  saved?: ServerSettings,
): readonly PendingScopedWrite[] {
  return writes.flatMap((write) => {
    const current = readSettings(write.environmentId);
    if (write.save !== target.save || write.environmentId !== target.environmentId) {
      return pendingWriteApplies(write, current) ? [write] : [];
    }
    if (saved === undefined || current === undefined || Equal.equals(current, saved)) return [];
    return [{ ...write, settledOver: current }];
  });
}

export function applyPendingScopedWrites<T extends ScopedSettingsEnvironment>(
  environments: readonly T[],
  writes: readonly PendingScopedWrite[],
): readonly T[] {
  if (writes.length === 0) return environments;
  return environments.map((environment) => {
    const config = environment.serverConfig;
    if (config === null) return environment;
    const settings = writes.reduce(
      (current, write) =>
        write.environmentId === environment.environmentId &&
        pendingWriteApplies(write, config.settings)
          ? applyServerSettingsPatch(current, write.patch)
          : current,
      config.settings,
    );
    if (settings === config.settings) return environment;
    // Legacy servers read `compactIdleThreads`, so project the mode back onto it.
    const { idleCompaction: _mode, ...legacy } = settings;
    const projected =
      config.settings.idleCompaction === undefined
        ? { ...legacy, ...idleCompactionPatch(config.settings, globalIdleCompaction(settings)) }
        : settings;
    return { ...environment, serverConfig: { ...config, settings: projected } };
  });
}

/** The representative supplies display values, never the set of write targets. */
export function selectScopedSettingsEnvironments<T extends ScopedSettingsEnvironment>(
  scope: ResolvedSettingsScope,
  available: readonly T[],
  primaryEnvironmentId: EnvironmentId | null,
) {
  const selectedIds = new Set(scope.environmentIds);
  const environments = available.filter((environment) =>
    selectedIds.has(environment.environmentId),
  );
  const connectedEnvironments = environments.filter(isConnectedWithConfig);
  const environment =
    connectedEnvironments.find((candidate) => candidate.environmentId === primaryEnvironmentId) ??
    connectedEnvironments[0] ??
    null;
  return { environments, connectedEnvironments, environment };
}

export interface ScopedSettingsTarget {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly projectId: ProjectId | null;
  readonly settings: ServerSettings;
  readonly sources: Readonly<Record<ProjectScopedServerSettingKey, ProjectSettingSource>>;
}

export function resolveScopedSettingsTargets(
  scope: ResolvedSettingsScope,
  connectedEnvironments: readonly ScopedSettingsEnvironment[],
  // A member absent here has no file tier yet; null is a missing or invalid file.
  projectFiles?: ReadonlyMap<string, T3ProjectFile | null>,
): readonly ScopedSettingsTarget[] {
  const byId = new Map(
    connectedEnvironments.map((environment) => [environment.environmentId, environment]),
  );
  if (scope.kind === "project" || scope.kind === "checkout") {
    return scope.members.flatMap((member) => {
      const environment = byId.get(member.environmentId);
      if (!environment?.serverConfig) return [];
      const projectFile = projectFiles?.get(member.physicalProjectKey);
      const resolved =
        projectFile === undefined
          ? resolveProjectSettings(environment.serverConfig.settings, member.id)
          : resolveProjectSettings(environment.serverConfig.settings, member.id, null, projectFile);
      return [
        {
          environmentId: member.environmentId,
          label: environment.label,
          projectId: member.id,
          settings: resolved.settings,
          sources: resolved.sources,
        },
      ];
    });
  }
  return connectedEnvironments.flatMap((environment) =>
    environment.serverConfig
      ? [
          {
            environmentId: environment.environmentId,
            label: environment.label,
            projectId: null,
            settings: environment.serverConfig.settings,
            sources: resolveProjectSettings(environment.serverConfig.settings, null).sources,
          },
        ]
      : [],
  );
}

export function scopedSettingsAreMixed(
  targets: readonly Pick<ScopedSettingsTarget, "settings">[],
  keys: readonly (keyof ServerSettings)[],
): boolean {
  const first = targets[0];
  return (
    first !== undefined &&
    targets.some((candidate) =>
      keys.some((key) => !Equal.equals(first.settings[key], candidate.settings[key])),
    )
  );
}

/**
 * Servers store the idle compaction mode differently by version, so selected
 * environments are compared by the mode each resolves to, and "Never" is offered
 * only when every one of them can store it.
 */
export function scopedIdleCompaction(targets: readonly Pick<ScopedSettingsTarget, "settings">[]) {
  const modes = targets.map((candidate) => globalIdleCompaction(candidate.settings));
  return {
    mixed: modes.some((mode) => mode !== modes[0]),
    neverAvailable: targets.every((candidate) => readsIdleCompactionModes(candidate.settings)),
  };
}

export type ScopedSettingSource = ProjectSettingSource | "mixed";

export function scopedSettingsSource(
  targets: readonly Pick<ScopedSettingsTarget, "sources">[],
  keys: readonly (keyof ServerSettings)[],
): ScopedSettingSource {
  const scoped = keys.filter(isProjectScopedSettingKey);
  if (scoped.length === 0 || targets.length === 0) return "environment";
  const sources = new Set(targets.flatMap((target) => scoped.map((key) => target.sources[key])));
  return sources.size > 1
    ? "mixed"
    : sources.has("project")
      ? "project"
      : sources.has("t3.json")
        ? "t3.json"
        : "environment";
}

function projectOverrideWrites(
  members: readonly { readonly id: ProjectId; readonly environmentId: EnvironmentId }[],
  environments: readonly ScopedSettingsEnvironment[],
  update: (
    current: ProjectSettingsOverrides,
    settings: ServerSettings,
    projectId: ProjectId,
  ) => ProjectSettingsOverrides | null,
): ScopedServerWrite[] {
  const byId = new Map(environments.map((environment) => [environment.environmentId, environment]));
  const writes = new Map<EnvironmentId, ScopedServerWrite>();
  for (const member of members) {
    const environment = byId.get(member.environmentId);
    if (!environment?.serverConfig || environment.connection.phase !== "connected") {
      continue;
    }
    const settings = environment.serverConfig.settings;
    const entry = update(settings.projectSettingsOverrides[member.id] ?? {}, settings, member.id);
    const existing = writes.get(member.environmentId);
    writes.set(member.environmentId, {
      environmentId: member.environmentId,
      label: environment.label,
      previous: settings,
      patch: {
        projectSettingsOverrides: {
          ...existing?.patch.projectSettingsOverrides,
          [member.id]: entry,
        },
      },
    });
  }
  return [...writes.values()];
}

/** Puts an idle compaction mode in the form each destination server reads. */
function forDestination(previous: ServerSettings, patch: ServerSettingsPatch): ServerSettingsPatch {
  if (patch.idleCompaction === undefined) return patch;
  const { idleCompaction, compactIdleThreads: _legacy, ...rest } = patch;
  return { ...rest, ...idleCompactionPatch(previous, idleCompaction) };
}

export function planScopedSettingsPatch(
  scope: ResolvedSettingsScope,
  environments: readonly ScopedSettingsEnvironment[],
  patch: ScopedSettingsPatch,
  options?: { readonly deviceOnly?: boolean },
) {
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const refusesClientKeys = isProjectScope && options?.deviceOnly !== true;
  const clientKeys = Object.keys(patch).filter(
    (key) => CLIENT_KEYS.has(key) && !SERVER_KEYS.has(key),
  );
  const serverPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => SERVER_KEYS.has(key)),
  ) as ServerSettingsPatch;
  const serverKeys = Object.keys(serverPatch);
  const { connectedEnvironments } = selectScopedSettingsEnvironments(scope, environments, null);
  // Client settings are stored per device, so a project has nowhere to keep an override.
  const unscopableKeys = isProjectScope
    ? [
        ...(refusesClientKeys ? clientKeys : []),
        ...serverKeys.filter((key) => !isProjectScopedSettingKey(key)),
      ]
    : [];
  const clientPatch = Object.fromEntries(
    refusesClientKeys ? [] : Object.entries(patch).filter(([key]) => clientKeys.includes(key)),
  ) as ClientSettingsPatch;
  const serverWrites: ScopedServerWrite[] =
    serverKeys.length === 0
      ? []
      : isProjectScope
        ? unscopableKeys.length > 0
          ? []
          : projectOverrideWrites(scope.members, environments, (current, settings, projectId) => {
              // Override entries store whole objects; complete partial patches from each target's effective
              // value.
              const effective = resolveProjectSettings(settings, projectId).settings;
              const next: Record<string, unknown> = { ...current };
              for (const [key, value] of Object.entries<unknown>(serverPatch)) {
                if (key === "worktreeCleanup" && serverPatch.worktreeCleanup?.mode === "custom") {
                  next[key] = {
                    mode: "custom",
                    rules: {
                      ...resolveWorktreeCleanup(settings, projectId),
                      ...serverPatch.worktreeCleanup.rules,
                    },
                  };
                  continue;
                }
                // Inherit sends null; remove overrides whose keys cannot store null.
                if (
                  value === null &&
                  !isNullableProjectSettingsOverride(key as ProjectScopedServerSettingKey)
                ) {
                  delete next[key];
                  continue;
                }
                const base: unknown = effective[key as keyof ServerSettings];
                // A new model must not inherit the previous model's options.
                if (
                  isPlainObject(value) &&
                  isPlainObject(base) &&
                  (key === "defaultModelSelection" ||
                    key === "sourceControlWriterModelSelection" ||
                    key === "reviewGuideModelSelection" ||
                    key === "textGenerationModelSelection") &&
                  (value.instanceId !== undefined || value.model !== undefined)
                ) {
                  next[key] = { instanceId: base.instanceId, model: base.model, ...value };
                  continue;
                }
                next[key] =
                  isPlainObject(value) && isPlainObject(base) ? { ...base, ...value } : value;
              }
              return next as ProjectSettingsOverrides;
            })
        : scope.kind === "all" || scope.kind === "environment"
          ? connectedEnvironments.flatMap((environment) => {
              const previous = environment.serverConfig?.settings;
              if (!previous) return [];
              return [
                {
                  environmentId: environment.environmentId,
                  label: environment.label,
                  previous,
                  patch: forDestination(
                    previous,
                    previous.worktreeCleanup != null &&
                      serverPatch.storageCleanup &&
                      Object.keys(serverPatch.storageCleanup).some((key) =>
                        key.startsWith("worktree"),
                      )
                      ? {
                          ...serverPatch,
                          worktreeCleanup: {
                            mode: "custom",
                            rules: {
                              ...resolveWorktreeCleanup(previous, null),
                              ...Object.fromEntries(
                                Object.entries(serverPatch.storageCleanup).filter(([key]) =>
                                  key.startsWith("worktree"),
                                ),
                              ),
                            },
                          },
                        }
                      : serverPatch,
                  ),
                },
              ];
            })
          : [];
  const hasClientWrite = Object.keys(clientPatch).length > 0;
  const hasWrite = hasClientWrite || serverWrites.length > 0;
  const unavailableReason =
    hasWrite || Object.keys(patch).length === 0
      ? null
      : scope.kind === "unavailable"
        ? scope.message
        : unscopableKeys.length > 0
          ? m(msg("This setting is environment-wide and cannot be overridden by a project."))
          : isProjectScope
            ? m(
                msg(
                  "Connect the selected checkouts, or update their environments, to save a project override.",
                ),
              )
            : scope.kind === "environment"
              ? m(msg("Connect {environment} to save this setting.", { environment: scope.label }))
              : m(msg("Connect an environment to save this setting."));
  return { clientPatch, hasClientWrite, serverWrites, unavailableReason };
}

export function planScopedSettingsClear(
  scope: ResolvedSettingsScope,
  environments: readonly ScopedSettingsEnvironment[],
  keys: readonly ProjectScopedServerSettingKey[],
) {
  const serverWrites =
    scope.kind === "project" || scope.kind === "checkout"
      ? projectOverrideWrites(scope.members, environments, (_current, settings, projectId) =>
          clearProjectSettingsOverrides(settings, projectId, keys),
        )
      : [];
  return {
    clientPatch: {} as ClientSettingsPatch,
    hasClientWrite: false,
    serverWrites,
    unavailableReason:
      serverWrites.length > 0
        ? null
        : m(
            msg(
              "Connect the selected checkouts, or update their environments, to reset this override.",
            ),
          ),
  };
}

export interface ProjectOverrideEntry {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

export function listProjectOverrides(
  environments: readonly ScopedSettingsEnvironment[],
  keys: readonly (keyof ServerSettings)[],
): readonly ProjectOverrideEntry[] {
  const scoped = keys.filter(isProjectScopedSettingKey);
  if (scoped.length === 0) return [];
  return environments.flatMap((environment) => {
    const overrides = environment.serverConfig?.settings.projectSettingsOverrides;
    if (!overrides) return [];
    return Object.entries(overrides).flatMap(([projectId, entry]) =>
      scoped.some((key) => Object.hasOwn(entry, key))
        ? [{ environmentId: environment.environmentId, projectId: projectId as ProjectId }]
        : [],
    );
  });
}

export function planProjectOverridesClear(
  environments: readonly ScopedSettingsEnvironment[],
  entries: readonly ProjectOverrideEntry[],
  keys: readonly ProjectScopedServerSettingKey[],
) {
  const byId = new Map(environments.map((environment) => [environment.environmentId, environment]));
  const writes = new Map<EnvironmentId, ScopedServerWrite>();
  for (const { environmentId, projectId } of entries) {
    const environment = byId.get(environmentId);
    if (!environment?.serverConfig || environment.connection.phase !== "connected") continue;
    const settings = environment.serverConfig.settings;
    const existing = writes.get(environmentId);
    writes.set(environmentId, {
      environmentId,
      label: environment.label,
      previous: settings,
      patch: {
        projectSettingsOverrides: {
          ...existing?.patch.projectSettingsOverrides,
          [projectId]: clearProjectSettingsOverrides(settings, projectId, keys),
        },
      },
    });
  }
  const serverWrites = [...writes.values()];
  return {
    clientPatch: {} as ClientSettingsPatch,
    hasClientWrite: false,
    serverWrites,
    unavailableReason:
      serverWrites.length > 0 ? null : m(msg("Connect the environments to reset these overrides.")),
  };
}

type ScopedSettingsPlan = ReturnType<typeof planScopedSettingsPatch>;

const unavailablePlan = (
  serverWrites: ScopedServerWrite[],
  unavailableReason: string,
): ScopedSettingsPlan => ({
  clientPatch: {},
  hasClientWrite: false,
  serverWrites,
  unavailableReason: serverWrites.length > 0 ? null : unavailableReason,
});

/** A project's override, written from outside Settings, such as a list row. */
export function planProjectOverridePatch(
  environments: readonly ScopedSettingsEnvironment[],
  members: readonly { readonly id: ProjectId; readonly environmentId: EnvironmentId }[],
  patch: ProjectSettingsOverrides,
): ScopedSettingsPlan {
  return unavailablePlan(
    projectOverrideWrites(members, environments, (current) => ({ ...current, ...patch })),
    "Connect this project's environment to save its setting.",
  );
}

/** One environment-wide patch for each connected environment. */
export function planEnvironmentSettingsPatch(
  environments: readonly ScopedSettingsEnvironment[],
  patch: ServerSettingsPatch,
): ScopedSettingsPlan {
  return unavailablePlan(
    environments.flatMap((environment) => {
      const previous = environment.serverConfig?.settings;
      if (!previous || environment.connection.phase !== "connected") return [];
      return [
        { environmentId: environment.environmentId, label: environment.label, previous, patch },
      ];
    }),
    "Connect the environment to save this setting.",
  );
}
