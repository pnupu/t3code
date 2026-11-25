import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { metadataUpdateMovesWorkspace, threadProjectMoveRefusal } from "./threadProjectMove.ts";

const from = ProjectId.make("project:move-from");
const to = ProjectId.make("project:move-to");
const idle = [{ status: "completed" }, { status: "queued" }];
const live = { archivedAt: null };
const answered = [{ status: "resolved" }];

describe("threadProjectMoveRefusal", () => {
  it("accepts an idle thread and a live target", () => {
    assert.isUndefined(
      threadProjectMoveRefusal({
        thread: { projectId: from },
        projectId: to,
        target: live,
        runs: idle,
        runtimeRequests: answered,
      }),
    );
  });

  it("rejects the thread's own project", () => {
    assert.equal(
      threadProjectMoveRefusal({
        thread: { projectId: from },
        projectId: from,
        target: live,
        runs: idle,
        runtimeRequests: answered,
      }),
      `is already in project ${from}.`,
    );
  });

  it("rejects a missing or deleted project", () => {
    assert.equal(
      threadProjectMoveRefusal({
        thread: { projectId: from },
        projectId: to,
        target: undefined,
        runs: idle,
        runtimeRequests: answered,
      }),
      `cannot move to missing project ${to}.`,
    );
  });

  it("rejects an archived project", () => {
    assert.equal(
      threadProjectMoveRefusal({
        thread: { projectId: from },
        projectId: to,
        target: { archivedAt: "2026-11-01T00:00:00.000Z" },
        runs: idle,
        runtimeRequests: answered,
      }),
      `cannot move to archived project ${to}.`,
    );
  });

  it("rejects a thread whose turn is in progress or waits on a question", () => {
    const busy = "has a running turn. Wait for it to finish, or stop it, then move the thread.";
    for (const status of ["preparing", "starting", "running", "waiting"]) {
      assert.equal(
        threadProjectMoveRefusal({
          thread: { projectId: from },
          projectId: to,
          target: live,
          runs: [...idle, { status }],
          runtimeRequests: answered,
        }),
        busy,
      );
    }
    assert.equal(
      threadProjectMoveRefusal({
        thread: { projectId: from },
        projectId: to,
        target: live,
        runs: idle,
        runtimeRequests: [{ status: "pending" }],
      }),
      busy,
    );
  });
});

describe("metadataUpdateMovesWorkspace", () => {
  const inRoot = { projectId: from, worktreePath: null };
  const inWorktree = { projectId: from, worktreePath: "/work/tree" };

  it("is true for a move of a thread that runs in its project root", () => {
    assert.isTrue(metadataUpdateMovesWorkspace({ projectId: to }, inRoot));
  });

  it("is false for a move of a thread with its own worktree", () => {
    assert.isFalse(metadataUpdateMovesWorkspace({ projectId: to }, inWorktree));
  });

  it("keeps the worktree rules for updates without a move", () => {
    assert.isFalse(metadataUpdateMovesWorkspace({}, inRoot));
    assert.isFalse(metadataUpdateMovesWorkspace({ projectId: from }, inRoot));
    assert.isFalse(metadataUpdateMovesWorkspace({ worktreePath: "/work/tree" }, inWorktree));
    assert.isTrue(metadataUpdateMovesWorkspace({ worktreePath: null }, inWorktree));
    assert.isTrue(metadataUpdateMovesWorkspace({ worktreePath: "/work/other" }, inRoot));
  });
});

const layerTest = ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

it.layer(layerTest)("thread project move projection", (it) => {
  it.effect("lists a moved thread under its new project only", () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:move-projection");
      const providerInstanceId = ProviderInstanceId.make("codex");
      const thread: OrchestrationV2AppThread = {
        createdBy: "user",
        creationSource: "web",
        id: threadId,
        projectId: from,
        title: "[autofixedcloud] Fix the deploy",
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      yield* store.apply({
        id: EventId.make("event:move-projection:created"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: thread,
      });
      yield* store.apply({
        id: EventId.make("event:move-projection:moved"),
        type: "thread.metadata-updated",
        threadId,
        providerInstanceId,
        occurredAt: now,
        payload: { ...thread, projectId: to, title: "Fix the deploy" },
      });

      const shell = yield* store.getThreadShell(threadId);
      assert.equal(shell?.projectId, to);
      assert.equal(shell?.title, "Fix the deploy");
      assert.isNull(shell?.worktreePath);
      const ids = (entries: ReadonlyArray<{ readonly id: ThreadId }>) =>
        entries.map((entry) => entry.id);
      assert.deepEqual(ids(yield* store.listActiveThreads(to)), [threadId]);
      assert.deepEqual(ids(yield* store.listActiveThreads(from)), []);
    }),
  );
});
