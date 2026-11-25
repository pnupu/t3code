import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import { OrchestrationV2Command, OrchestrationV2DomainEventJson } from "./orchestrationV2.ts";
import { ThreadMetadataMcpUpdateInput } from "./threadMetadataMcp.ts";

const decodeCommand = Schema.decodeUnknownSync(OrchestrationV2Command);
const decodeEvent = Schema.decodeUnknownSync(OrchestrationV2DomainEventJson);
const decodeMcp = Schema.decodeUnknownSync(ThreadMetadataMcpUpdateInput);

const at = "2026-11-01T00:00:00.000Z";
const storedMetadataEvent = {
  id: "event:old-metadata",
  type: "thread.metadata-updated",
  threadId: "thread:old",
  providerInstanceId: "codex",
  occurredAt: at,
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: "thread:old",
    projectId: "project:old",
    title: "Old thread",
    providerInstanceId: "codex",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "thread:old" },
    forkedFrom: null,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  },
};

describe("thread project move wire format", () => {
  it("decodes a metadata update without projectId as before", () => {
    const command = decodeCommand({
      type: "thread.metadata.update",
      commandId: "command:old",
      threadId: "thread:old",
      title: "Renamed",
    });
    assert.equal(command.type, "thread.metadata.update");
    assert.isFalse("projectId" in command);
  });

  it("decodes a metadata update that moves the thread", () => {
    const command = decodeCommand({
      type: "thread.metadata.update",
      commandId: "command:move",
      threadId: "thread:old",
      projectId: "project:new",
    });
    assert.deepInclude(command, { projectId: ProjectId.make("project:new") });
  });

  it("decodes a stored metadata event with the thread's project", () => {
    const event = decodeEvent(storedMetadataEvent);
    assert.equal(event.type, "thread.metadata-updated");
    assert.deepInclude(event.payload, { projectId: ProjectId.make("project:old") });
  });

  it("accepts move only with a projectId, and projectId only on move", () => {
    const moved = decodeMcp({ action: "move", projectId: "project:new", title: "Fix deploy" });
    assert.equal(moved.projectId, "project:new");
    assert.equal(moved.title, "Fix deploy");
    assert.throws(() => decodeMcp({ action: "move" }));
    assert.throws(() => decodeMcp({ action: "rename", title: "x", projectId: "project:new" }));
    assert.throws(() => decodeMcp({ action: "regenerate_title", projectId: "project:new" }));
  });
});
