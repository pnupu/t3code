import { describe, expect, it } from "vite-plus/test";

import {
  mainReadState,
  pullRequestLoadMore,
  type PullRequestReadState,
} from "./pullRequestLoadMore.logic";

describe("pullRequestLoadMore", () => {
  it.each<[string, PullRequestReadState, boolean, string | null]>([
    ["a truncated list grows", "truncated", true, "button"],
    ["a failed page is asked for again", "failed", true, "button"],
    ["a complete list offers nothing", "complete", false, null],
    ["a capped list asks for a narrower search", "capped", false, "narrow"],
    // A page in flight is not restarted by another click.
    ["a page in flight spins", "pending", false, "loading"],
  ])("%s", (_, main, grow, footer) => {
    expect(pullRequestLoadMore(main)).toEqual({ grow, footer });
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
});
