/**
 * Where the main list stands. `truncated` can still grow; `capped` has more rows but no way to
 * reach them; `pending` is a page in flight; `failed` is a page that can be asked for again.
 */
export type PullRequestReadState = "pending" | "complete" | "truncated" | "capped" | "failed";

export interface PullRequestLoadMorePlan {
  /** Load more asks for the next page, or again after it failed. */
  readonly grow: boolean;
  readonly footer: "loading" | "button" | "narrow" | null;
}

/**
 * The main list's state. One environment's failed read does not stop the others: the list is
 * `failed` only when no environment can continue, and then Load more asks again.
 */
export function mainReadState(input: {
  readonly truncated: boolean;
  readonly loading: boolean;
  readonly canContinue: boolean;
  readonly canGrow: boolean;
  readonly failed: boolean;
}): PullRequestReadState {
  if (!input.truncated) return "complete";
  if (input.loading) return "pending";
  if (!input.canGrow) return "capped";
  return input.failed && !input.canContinue ? "failed" : "truncated";
}

/** What Load more does and what the footer shows. A page in flight is never restarted. */
export function pullRequestLoadMore(main: PullRequestReadState): PullRequestLoadMorePlan {
  if (main === "pending") return { grow: false, footer: "loading" };
  const grow = main === "truncated" || main === "failed";
  return { grow, footer: grow ? "button" : main === "capped" ? "narrow" : null };
}
