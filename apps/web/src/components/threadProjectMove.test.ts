import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { movedToProjectId, threadMoveMenuItems, threadMoveTargets } from "./threadProjectMove";

const here = EnvironmentId.make("environment:here");
const elsewhere = EnvironmentId.make("environment:elsewhere");
const project = (environmentId: EnvironmentId, id: string, title: string, extra = {}) => ({
  environmentId,
  id: ProjectId.make(id),
  title,
  workspaceRoot: `/work/${id}`,
  ...extra,
});
const projects = [
  project(here, "current", "upcloud siirto"),
  project(here, "target", "autofixed-cloud"),
  project(here, "another", "Locorum"),
  project(here, "old", "Old", { archivedAt: "2026-11-01T00:00:00.000Z" }),
  project(here, "scratch", "Scratch", { isScratch: true }),
  project(elsewhere, "remote", "Remote"),
];
const config = { environment: { capabilities: { threadProjectMove: true } } };
const thread = { environmentId: here, projectId: ProjectId.make("current") };

describe("threadMoveTargets", () => {
  it("lists the other live projects on the thread's server, by name", () => {
    expect(threadMoveTargets({ thread, projects, config })).toEqual([
      { id: "target", label: "autofixed-cloud" },
      { id: "another", label: "Locorum" },
    ]);
  });

  it("lists nothing on a server that cannot move threads", () => {
    expect(
      threadMoveTargets({ thread, projects, config: { environment: { capabilities: {} } } }),
    ).toEqual([]);
    expect(threadMoveTargets({ thread, projects, config: undefined })).toEqual([]);
  });
});

describe("threadMoveMenuItems", () => {
  const targets = threadMoveTargets({ thread, projects, config });

  it("offers one submenu item per target, disabled while the thread runs", () => {
    const [item] = threadMoveMenuItems(targets, false);
    expect(item?.label).toBe("Move to project…");
    expect(item?.disabled).toBe(false);
    expect(item?.children?.map((child) => child.id)).toEqual([
      "move-to-project:target",
      "move-to-project:another",
    ]);
    expect(threadMoveMenuItems(targets, true)[0]?.disabled).toBe(true);
    expect(threadMoveMenuItems([], false)).toEqual([]);
  });

  it("reads back only a listed target", () => {
    expect(movedToProjectId("move-to-project:target", targets)).toBe("target");
    expect(movedToProjectId("move-to-project:remote", targets)).toBeNull();
    expect(movedToProjectId("rename", targets)).toBeNull();
  });
});
