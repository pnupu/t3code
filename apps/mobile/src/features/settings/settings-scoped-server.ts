import {
  isManagedSettingPath,
  isNullableProjectSettingsOverride,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type EnvironmentId,
  type ProjectId,
  type ProjectScopedServerSettingKey,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  clearProjectSettingsOverrides,
  resolveProjectSettings,
} from "@t3tools/shared/projectSettings";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";

import type { SettingsTarget } from "./settings-environment-filter";

export interface ScopedMobileSettingsTarget {
  readonly environment: SettingsTarget;
  readonly projectId: ProjectId | null;
  readonly settings: ServerSettings;
  readonly sources: ReturnType<typeof resolveProjectSettings>["sources"];
}

/**
 * "Managed by <organization>." when any target's policy locks `path`: the server refuses the
 * whole write then, so the control is managed for the selection.
 */
export function managedSettingReason(
  targets: readonly ScopedMobileSettingsTarget[],
  ...paths: readonly string[]
): string | undefined {
  const policy = targets
    .map((target) => target.environment.serverConfig.managedPolicy)
    .find((candidate) => paths.some((path) => isManagedSettingPath(candidate, path)));
  return policy === undefined ? undefined : `Managed by ${policy.organization}.`;
}

export function resolveMobileSettingsTargets(
  environments: readonly SettingsTarget[],
  members: readonly { readonly environmentId: EnvironmentId; readonly id: ProjectId }[] | null,
): readonly ScopedMobileSettingsTarget[] {
  if (members === null) {
    return environments.map((environment) => ({
      environment,
      projectId: null,
      ...resolveProjectSettings(environment.serverConfig.settings, null),
    }));
  }
  const byId = new Map(environments.map((environment) => [environment.environmentId, environment]));
  return members.flatMap((member) => {
    const environment = byId.get(member.environmentId);
    if (!environment) return [];
    return [
      {
        environment,
        projectId: member.id,
        ...resolveProjectSettings(environment.serverConfig.settings, member.id),
      },
    ];
  });
}

export function planMobileScopedSettingsPatch(
  targets: readonly ScopedMobileSettingsTarget[],
  projectSelected: boolean,
  patch: ServerSettingsPatch,
) {
  if (!projectSelected) {
    return targets.map((target) => ({ environmentId: target.environment.environmentId, patch }));
  }
  const keys = Object.keys(patch);
  if (
    keys.some(
      (key) => !PROJECT_SCOPED_SERVER_SETTING_KEYS.includes(key as ProjectScopedServerSettingKey),
    )
  )
    return [];
  const writes = new Map<EnvironmentId, Record<string, unknown>>();
  for (const target of targets) {
    if (target.projectId === null) continue;
    const current =
      target.environment.serverConfig.settings.projectSettingsOverrides[target.projectId] ?? {};
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (
        value === null &&
        !isNullableProjectSettingsOverride(key as ProjectScopedServerSettingKey)
      ) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    const overrides = writes.get(target.environment.environmentId) ?? {};
    overrides[target.projectId] = next;
    writes.set(target.environment.environmentId, overrides);
  }
  return [...writes].map(([environmentId, projectSettingsOverrides]) => ({
    environmentId,
    patch: { projectSettingsOverrides } as ServerSettingsPatch,
  }));
}

export function uniformMobileSetting<K extends keyof ServerSettings>(
  targets: readonly Pick<ScopedMobileSettingsTarget, "settings">[],
  key: K,
): ServerSettings[K] | null {
  const reference = targets[0];
  if (!reference) return null;
  const value = reference.settings[key];
  return targets.every((target) => target.settings[key] === value) ? value : null;
}

export function planMobileScopedSettingsClear(
  targets: readonly ScopedMobileSettingsTarget[],
  keys: readonly ProjectScopedServerSettingKey[],
) {
  const writes = new Map<EnvironmentId, Record<string, unknown>>();
  for (const target of targets) {
    if (target.projectId === null) continue;
    const overrides = writes.get(target.environment.environmentId) ?? {};
    overrides[target.projectId] = clearProjectSettingsOverrides(
      target.environment.serverConfig.settings,
      target.projectId,
      keys,
    );
    writes.set(target.environment.environmentId, overrides);
  }
  return [...writes].map(([environmentId, projectSettingsOverrides]) => ({
    environmentId,
    patch: { projectSettingsOverrides } as ServerSettingsPatch,
  }));
}

/** A save this device sent; `repliedOver` is the cached copy when the server answered. */
export interface PendingMobileSettingsWrite {
  readonly save: object;
  readonly environmentId: EnvironmentId;
  readonly patch: ServerSettingsPatch;
  readonly repliedOver?: ServerSettings | undefined;
}

/** In flight, or saved while the cached copy still predates it. */
const pendingWriteApplies = (write: PendingMobileSettingsWrite, cached: ServerSettings) =>
  !("repliedOver" in write) || write.repliedOver === cached;

/**
 * Cached settings with this device's unanswered saves on top. Project overrides are saved as
 * whole entries, so a plan made from the cache alone would erase a pending change to another
 * key of the same project.
 */
export function withPendingMobileSettingsWrites<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly serverConfig: { readonly settings: ServerSettings };
  },
>(targets: readonly T[], writes: readonly PendingMobileSettingsWrite[]): readonly T[] {
  if (writes.length === 0) return targets;
  return targets.map((target) => {
    const cached = target.serverConfig.settings;
    const settings = writes.reduce(
      (current, write) =>
        write.environmentId === target.environmentId && pendingWriteApplies(write, cached)
          ? applyServerSettingsPatch(current, write.patch)
          : current,
      cached,
    );
    return settings === cached
      ? target
      : { ...target, serverConfig: { ...target.serverConfig, settings } };
  });
}

/** Drops saves the cache has caught up with: any update after the reply answers one. */
export function settlePendingMobileSettingsWrites(
  writes: readonly PendingMobileSettingsWrite[],
  settingsOf: (environmentId: EnvironmentId) => ServerSettings | undefined,
): readonly PendingMobileSettingsWrite[] {
  return writes.filter((write) => {
    const cached = settingsOf(write.environmentId);
    return cached !== undefined && pendingWriteApplies(write, cached);
  });
}
