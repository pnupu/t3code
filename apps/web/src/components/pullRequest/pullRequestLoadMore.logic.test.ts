import { describe, expect, it } from "vite-plus/test";

import {
  combinedReadState,
  mainReadState,
  mergePagedListing,
  nextPagedSend,
  pagedListingState,
  pullRequestLoadMore,
  type PullRequestReadState,
} from "./pullRequestLoadMore.logic";

describe("pullRequestLoadMore", () => {
  it.each<
    [string, PullRequestReadState, PullRequestReadState | null, boolean, boolean, string | null]
  >([
    ["a truncated main list grows", "truncated", null, true, false, "button"],
    ["a failed main page is asked for again", "failed", "complete", true, false, "button"],
    ["a complete feed offers nothing", "complete", "complete", false, false, null],
    ["a capped main list asks for a narrower search", "capped", null, false, false, "narrow"],
    // The involved listing can have more while the main list is done, and the reverse.
    ["only the involved listing grows", "complete", "truncated", false, true, "button"],
    ["both grow together", "truncated", "truncated", true, true, "button"],
    ["a failed involved page is asked for again", "capped", "failed", false, true, "button"],
    // A page in flight is not restarted by another click, whichever read it belongs to.
    ["a main page in flight spins", "pending", "truncated", false, false, "loading"],
    ["an involved page in flight spins", "truncated", "pending", false, false, "loading"],
  ])("%s", (_, main, involved, growMain, growInvolved, footer) => {
    expect(pullRequestLoadMore(main, involved)).toEqual({ growMain, growInvolved, footer });
  });

  it("waits on the listing most in need when several page together", () => {
    expect(combinedReadState([null, null])).toBeNull();
    expect(combinedReadState(["complete", "truncated", null])).toBe("truncated");
    expect(combinedReadState(["truncated", "failed"])).toBe("failed");
    expect(combinedReadState(["failed", "pending", "complete"])).toBe("pending");
    expect(combinedReadState(["complete", "complete"])).toBe("complete");
  });

  it.each<[string, boolean, boolean, boolean, PullRequestReadState]>([
    // One environment's failure does not stop the others from paging.
    ["one failed environment, others continue", true, true, true, "truncated"],
    ["no environment can continue after a failure", true, false, true, "failed"],
    ["nothing failed", false, true, true, "truncated"],
    ["no cursor and no larger page", false, false, false, "capped"],
  ])("main list: %s", (_, failed, canContinue, canGrow, state) => {
    expect(mainReadState({ truncated: true, loading: false, canContinue, canGrow, failed })).toBe(
      state,
    );
  });

  it("pages each environment of a listing on its own", () => {
    // Environment a has more, b failed: Load more advances a and asks b again.
    expect(
      pagedListingState({ active: true, pending: false, failed: ["b"], nextCursors: { a: 1 } }),
    ).toBe("truncated");
    expect(
      pagedListingState({ active: true, pending: false, failed: ["b"], nextCursors: {} }),
    ).toBe("failed");
    expect(nextPagedSend({ a: "a2" }, ["b"], { a: "a1", b: "b1" })).toEqual({ a: "a2", b: "b1" });
    expect(nextPagedSend({}, ["b"], null)).toEqual({ b: null });
  });

  it("keeps loaded rows and other repositories' errors across pages and refreshes", () => {
    const row = (url: string, updatedAt: string, projectId = "web") => ({
      url,
      updatedAt,
      projectId,
      environmentId: "a",
    });
    const held = {
      entries: [row("https://h/1", "2026-07-09"), row("https://h/2", "2026-07-08")],
      errors: [
        { environmentId: "a", projectId: "unindexed" },
        { environmentId: "a", projectId: "retried" },
      ],
      answered: ["a", "b"],
      nextCursors: { a: { web: "a2" }, b: { docs: "b2" } },
    };
    // A continuation for a: b did not answer and keeps its cursor, and only the project it brought
    // rows for loses its error.
    const continued = mergePagedListing(
      held,
      {
        entries: [row("https://h/3", "2026-07-07"), row("https://h/9", "2026-07-07", "retried")],
        errors: [],
        answered: ["a"],
        nextCursors: { a: { web: "a3" } },
      },
      { a: { web: "a2" }, b: { docs: "b2" } },
    );
    expect(continued.entries.map((entry) => entry.url)).toEqual([
      "https://h/1",
      "https://h/2",
      "https://h/3",
      "https://h/9",
    ]);
    expect(continued.errors).toEqual([{ environmentId: "a", projectId: "unindexed" }]);
    expect(continued.nextCursors).toEqual({ a: { web: "a3" }, b: { docs: "b2" } });
    // A refreshed first page with more replaces the rows in its span: #1 was merged and is gone,
    // older loaded rows stay, and the deeper cursor still reaches past them.
    const refreshed = mergePagedListing(
      continued,
      {
        entries: [row("https://h/2", "2026-07-08")],
        errors: [],
        answered: ["a"],
        nextCursors: { a: { web: "a2" } },
      },
      null,
    );
    expect(refreshed.entries.map((entry) => entry.url)).toEqual([
      "https://h/3",
      "https://h/9",
      "https://h/2",
    ]);
    expect(refreshed.errors).toEqual([]);
    expect(refreshed.nextCursors).toEqual({ a: { web: "a3" }, b: { docs: "b2" } });
    // A first page that has no more replaces every row of its environment.
    const complete = mergePagedListing(
      refreshed,
      { entries: [row("https://h/2", "2026-07-08")], errors: [], answered: ["a"], nextCursors: {} },
      null,
    );
    expect(complete.entries.map((entry) => entry.url)).toEqual(["https://h/2"]);
    expect(complete.nextCursors).toEqual({ b: { docs: "b2" } });
  });
});
