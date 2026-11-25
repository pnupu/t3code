import type { OrchestrationV2DomainEvent, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

/**
 * Points a moved thread's bound tasks at its new project, whichever client moved it.
 * `seen` keeps each thread's last project, so a rename or branch sync writes nothing.
 */
export const followMovedThread = Effect.fn("ThreadMoveTaskFollower.follow")(function* (
  scheduledTasks: ScheduledTaskService.ScheduledTaskService["Service"],
  seen: Map<ThreadId, ProjectId>,
  event: OrchestrationV2DomainEvent,
) {
  if (event.type === "thread.deleted") seen.delete(event.threadId);
  if (event.type !== "thread.metadata-updated" && event.type !== "thread.created") return;
  const projectId = event.payload.projectId;
  const known = seen.get(event.threadId);
  seen.set(event.threadId, projectId);
  if (event.type === "thread.created" || known === projectId) return;
  yield* scheduledTasks.moveThreadTasks({ threadIds: [event.threadId], projectId });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
    const seen = new Map<ThreadId, ProjectId>();
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        followMovedThread(scheduledTasks, seen, event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("moving a moved thread's scheduled tasks failed", {
              threadId: event.threadId,
              cause,
            }),
          ),
        ),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("scheduled task move event stream failed", { cause }),
        ),
      ),
    );
  }),
);
