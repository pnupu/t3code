import { describe, expect, it } from "vite-plus/test";

import {
  combinedReadState,
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
});
