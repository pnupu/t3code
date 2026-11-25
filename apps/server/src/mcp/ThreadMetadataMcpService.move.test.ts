import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import { refuseScratchMoveTarget } from "./threadMoveTarget.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as ThreadMetadataMcpService from "./ThreadMetadataMcpService.ts";

const threadId = ThreadId.make("thread:mcp-move");
const from = ProjectId.make("project:upcloud-siirto");
const to = ProjectId.make("project:autofixed-cloud");
const dispatched: Array<unknown> = [];
const shell = {
  id: threadId,
  projectId: from,
  title: "[autofixedcloud] Fix the deploy",
  deletedAt: null,
} as unknown as OrchestrationV2ThreadShell;

const layerThreads = Layer.mock(ThreadManagementService.ThreadManagementService)({
  getThreadShell: () => Effect.succeed(shell),
  dispatch: (command) =>
    Effect.gen(function* () {
      dispatched.push(command);
      const now = yield* DateTime.now;
      const update = command as Extract<OrchestrationV2Command, { type: "thread.metadata.update" }>;
      return {
        sequence: 7,
        storedEvents: [
          {
            event: {
              type: "thread.metadata-updated",
              payload: {
                ...shell,
                projectId: update.projectId ?? from,
                title: update.title ?? shell.title,
                updatedAt: now,
              },
            },
          },
        ],
      } as never;
    }),
});

const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:mcp-move"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  requestNamespace: "client:mcp-move",
  thread: undefined,
  client: undefined,
};

it.layer(
  ThreadMetadataMcpService.layer.pipe(Layer.provide(Layer.merge(layerThreads, NodeCrypto.layer))),
)("t3_thread_update move", (it) => {
  it.effect("moves the thread and renames it in one command", () =>
    Effect.gen(function* () {
      const service = yield* ThreadMetadataMcpService.ThreadMetadataMcpService;
      const result = yield* service.update(scope, {
        threadId,
        action: "move",
        projectId: to,
        title: "Fix the deploy",
      });

      assert.deepInclude(dispatched[0], {
        type: "thread.metadata.update",
        threadId,
        projectId: to,
        title: "Fix the deploy",
      });
      assert.equal(result.action, "move");
      assert.equal(result.projectId, to);
      assert.equal(result.title, "Fix the deploy");
    }),
  );
});

it.effect("refuses a move to the No project folder", () =>
  Effect.gen(function* () {
    const scratch = ProjectId.make("project:scratch");
    const folders = Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/work/projects",
      isScratchProject: (projectId) => Effect.succeed(projectId === scratch),
    });
    const failure = yield* refuseScratchMoveTarget(scratch).pipe(
      Effect.flip,
      Effect.provide(folders),
    );
    assert.equal(failure.code, "invalid_request");
    yield* refuseScratchMoveTarget(to).pipe(Effect.provide(folders));
  }),
);
