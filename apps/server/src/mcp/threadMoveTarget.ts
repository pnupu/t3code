import { OrchestratorMcpFailure, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";

/** A thread without its own folder would run in the No project root, beside every scratch folder. */
export const refuseScratchMoveTarget = Effect.fn("refuseScratchMoveTarget")(function* (
  projectId: ProjectId | undefined,
) {
  if (projectId === undefined) return;
  // Read as optional so the orchestrator toolkit keeps its declared dependencies; the server provides it.
  const folders = yield* Effect.serviceOption(ManagedProjectFolders.ManagedProjectFolders);
  if (Option.isSome(folders) && (yield* folders.value.isScratchProject(projectId))) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "A thread cannot move to No project. Pick a project with its own folder.",
    });
  }
});
