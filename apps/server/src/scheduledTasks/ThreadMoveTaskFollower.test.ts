import { assert, it } from "@effect/vitest";
import { type OrchestrationV2DomainEvent, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as ScheduledTaskService from "./ScheduledTaskService.ts";
import { followMovedThread } from "./ThreadMoveTaskFollower.ts";

it.effect("points a moved thread's tasks at its new project, once per move", () =>
  Effect.gen(function* () {
    const moves: Array<unknown> = [];
    const tasks = {
      moveThreadTasks: (input: unknown) => Effect.sync(() => void moves.push(input)),
    } as unknown as ScheduledTaskService.ScheduledTaskService["Service"];
    const threadId = ThreadId.make("thread:moved");
    const projectId = ProjectId.make("project:new");

    const seen = new Map<ThreadId, ProjectId>();
    const event = (type: string, project: ProjectId) =>
      ({
        type,
        threadId,
        payload: { projectId: project },
      }) as unknown as OrchestrationV2DomainEvent;
    const oldProject = ProjectId.make("project:old");

    yield* followMovedThread(tasks, seen, event("thread.created", oldProject));
    yield* followMovedThread(tasks, seen, event("thread.metadata-updated", oldProject));
    yield* followMovedThread(tasks, seen, event("thread.pinned", projectId));
    yield* followMovedThread(tasks, seen, event("thread.metadata-updated", projectId));
    yield* followMovedThread(tasks, seen, event("thread.metadata-updated", projectId));

    assert.deepEqual(moves, [{ threadIds: [threadId], projectId }]);
  }),
);
