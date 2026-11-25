import type { OrchestrationV2AppThread, ProjectId } from "@t3tools/contracts";

const TURN_IN_PROGRESS = new Set(["preparing", "starting", "running", "waiting"]);

/** The reason a thread cannot move to `projectId`, or undefined when it can. */
export function threadProjectMoveRefusal(input: {
  readonly thread: Pick<OrchestrationV2AppThread, "projectId">;
  readonly projectId: ProjectId;
  /** Undefined for a missing or deleted project. */
  readonly target: { readonly archivedAt: string | null } | undefined;
  readonly runs: ReadonlyArray<{ readonly status: string }>;
  readonly runtimeRequests: ReadonlyArray<{ readonly status: string }>;
}): string | undefined {
  if (input.projectId === input.thread.projectId)
    return `is already in project ${input.projectId}.`;
  if (input.target === undefined) return `cannot move to missing project ${input.projectId}.`;
  if (input.target.archivedAt !== null)
    return `cannot move to archived project ${input.projectId}.`;
  // A waiting turn or an open question still owns the provider session that a move detaches.
  if (
    input.runs.some((run) => TURN_IN_PROGRESS.has(run.status)) ||
    input.runtimeRequests.some((request) => request.status === "pending")
  ) {
    return "has a running turn. Wait for it to finish, or stop it, then move the thread.";
  }
  return undefined;
}

/**
 * True when the update changes the folder the thread runs in. A thread without its own
 * worktree runs in its project's root, so a project move changes its folder too.
 */
export function metadataUpdateMovesWorkspace(
  command: {
    readonly projectId?: ProjectId | undefined;
    readonly worktreePath?: string | null | undefined;
  },
  thread: Pick<OrchestrationV2AppThread, "projectId" | "worktreePath">,
): boolean {
  const worktreePath =
    command.worktreePath === undefined ? thread.worktreePath : command.worktreePath;
  if (worktreePath !== thread.worktreePath) return true;
  return (
    worktreePath === null &&
    command.projectId !== undefined &&
    command.projectId !== thread.projectId
  );
}
