import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { ContextMenuItem, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export interface ThreadMoveTarget {
  readonly id: ProjectId;
  readonly label: string;
}

const MOVE_PREFIX = "move-to-project:";

/** The other live projects on the thread's server, or none when that server cannot move threads. */
export function threadMoveTargets(input: {
  readonly thread: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
  readonly projects: ReadonlyArray<
    Pick<
      EnvironmentProject,
      "environmentId" | "id" | "title" | "workspaceRoot" | "isScratch" | "archivedAt"
    >
  >;
  readonly config:
    | {
        readonly environment: { readonly capabilities: { readonly threadProjectMove?: boolean } };
        readonly scratchWorkspaceRoot?: string | null;
      }
    | undefined;
}): ReadonlyArray<ThreadMoveTarget> {
  if (input.config?.environment.capabilities.threadProjectMove !== true) return [];
  return input.projects
    .filter(
      (project) =>
        project.environmentId === input.thread.environmentId &&
        project.id !== input.thread.projectId &&
        project.archivedAt == null &&
        !isScratchProject(project, input.config?.scratchWorkspaceRoot),
    )
    .map((project) => ({ id: project.id, label: project.title }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

export function threadMoveMenuItems(
  targets: ReadonlyArray<ThreadMoveTarget> | undefined,
  isRunning: boolean,
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<"move-to-project" | `move-to-project:${string}`>> {
  if (targets === undefined || targets.length === 0) return [];
  return [
    {
      id: "move-to-project",
      label: resolve(msg("Move to project…")),
      icon: "folder",
      disabled: isRunning,
      children: targets.map((target) => ({
        id: `${MOVE_PREFIX}${target.id}` as const,
        label: target.label,
      })),
    },
  ];
}

/** The project a "Move to project" pick names, or null for any other action. */
export function movedToProjectId(
  action: string,
  targets: ReadonlyArray<ThreadMoveTarget>,
): ProjectId | null {
  if (!action.startsWith(MOVE_PREFIX)) return null;
  const id = action.slice(MOVE_PREFIX.length);
  return targets.find((target) => target.id === id)?.id ?? null;
}
