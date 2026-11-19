/**
 * Where a paged read stands. `truncated` can still grow; `capped` has more rows but no way to
 * reach them; `pending` is a page in flight; `failed` is a page that can be asked for again.
 */
export type PullRequestReadState = "pending" | "complete" | "truncated" | "capped" | "failed";

export interface PullRequestLoadMorePlan {
  /** Load more asks the main list for its next page, or again after it failed. */
  readonly growMain: boolean;
  /** Load more asks the involved listing for its next page, or again after it failed. */
  readonly growInvolved: boolean;
  readonly footer: "loading" | "button" | "narrow" | null;
}

/** Several listings that page together wait on the one most in need: in flight, failed, more. */
export function combinedReadState(
  states: ReadonlyArray<PullRequestReadState | null>,
): PullRequestReadState | null {
  const present = states.filter((state) => state !== null);
  if (present.length === 0) return null;
  for (const state of ["pending", "failed", "truncated", "capped"] as const) {
    if (present.includes(state)) return state;
  }
  return "complete";
}

/**
 * One Load more drives the main list and the involved listing together. A page in flight is never
 * restarted: while either read travels the footer spins and the button waits.
 */
export function pullRequestLoadMore(
  main: PullRequestReadState,
  involved: PullRequestReadState | null,
): PullRequestLoadMorePlan {
  if (main === "pending" || involved === "pending") {
    return { growMain: false, growInvolved: false, footer: "loading" };
  }
  const growMain = main === "truncated" || main === "failed";
  const growInvolved = involved === "truncated" || involved === "failed";
  return {
    growMain,
    growInvolved,
    footer: growMain || growInvolved ? "button" : main === "capped" ? "narrow" : null,
  };
}
