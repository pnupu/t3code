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

/** What a paged listing sends: per environment, its cursors or `null` for its first page. */
export type PagedListingSend<Cursors> = Readonly<Record<string, Cursors | null>> | null;

export interface PagedListing<Entry, Error, Cursors> {
  readonly entries: ReadonlyArray<Entry>;
  readonly errors: ReadonlyArray<Error>;
  readonly answered: ReadonlyArray<string>;
  /** Per environment, where its next page starts; absent once it has no more. */
  readonly nextCursors: Readonly<Record<string, Cursors>>;
}

/**
 * Adds one answered read to a paged listing. A first page replaces its environment's rows within
 * its span and its errors; rows older than a first page that has more stay, with the deeper cursor
 * that reaches past them, so a refresh never shrinks what the reader loaded. A continuation clears
 * the errors of projects it brought rows for; an environment that did not answer keeps its cursors.
 */
export function mergePagedListing<
  Entry extends {
    readonly url: string;
    readonly environmentId: string;
    readonly projectId: string;
    readonly updatedAt: string;
  },
  Error extends { readonly environmentId: string; readonly projectId?: string },
  Cursors extends Readonly<Record<string, string>>,
>(
  held: PagedListing<Entry, Error, Cursors> | null,
  page: PagedListing<Entry, Error, Cursors>,
  sent: PagedListingSend<Cursors>,
): PagedListing<Entry, Error, Cursors> {
  const firstPage = (environmentId: string) =>
    page.answered.includes(environmentId) && (sent === null || sent[environmentId] === null);
  const oldest = new Map<string, string>();
  for (const entry of page.entries) {
    const at = oldest.get(entry.environmentId);
    if (at === undefined || entry.updatedAt < at) oldest.set(entry.environmentId, entry.updatedAt);
  }
  const byUrl = new Map<string, Entry>();
  for (const entry of held?.entries ?? []) {
    const environmentId = entry.environmentId;
    const boundary = oldest.get(environmentId);
    const kept =
      !firstPage(environmentId) ||
      (page.nextCursors[environmentId] !== undefined &&
        (boundary === undefined || entry.updatedAt < boundary));
    if (kept) byUrl.set(entry.url, entry);
  }
  for (const entry of page.entries) byUrl.set(entry.url, entry);
  const read = new Set(page.entries.map((entry) => `${entry.environmentId} ${entry.projectId}`));
  const errors = new Map<string, Error>();
  for (const error of held?.errors ?? []) {
    const errorKey = `${error.environmentId} ${error.projectId ?? ""}`;
    if (!firstPage(error.environmentId) && !read.has(errorKey)) errors.set(errorKey, error);
  }
  for (const error of page.errors)
    errors.set(`${error.environmentId} ${error.projectId ?? ""}`, error);
  const nextCursors: Record<string, Cursors> = { ...held?.nextCursors };
  for (const environmentId of page.answered) {
    const next = page.nextCursors[environmentId];
    const deeper = firstPage(environmentId) ? held?.nextCursors[environmentId] : undefined;
    if (next === undefined) delete nextCursors[environmentId];
    else if (deeper === undefined) nextCursors[environmentId] = next;
    else {
      nextCursors[environmentId] = Object.fromEntries(
        Object.entries(next).map(([repository, cursor]) => [
          repository,
          deeper[repository] ?? cursor,
        ]),
      ) as Cursors;
    }
  }
  return {
    entries: [...byUrl.values()],
    errors: [...errors.values()],
    answered: [...new Set([...(held?.answered ?? []), ...page.answered])],
    nextCursors,
  };
}

/** A paged listing can go on while any environment that did not fail has a next page. */
export function pagedListingState(input: {
  readonly active: boolean;
  readonly pending: boolean;
  readonly failed: ReadonlyArray<string>;
  readonly nextCursors: Readonly<Record<string, unknown>>;
}): PullRequestReadState | null {
  if (!input.active) return null;
  if (input.pending) return "pending";
  const continues = Object.keys(input.nextCursors).some(
    (environmentId) => !input.failed.includes(environmentId),
  );
  if (continues) return "truncated";
  return input.failed.length > 0 ? "failed" : "complete";
}

/** The next send: environments with a next page advance, and failed ones ask for theirs again. */
export function nextPagedSend<Cursors>(
  nextCursors: Readonly<Record<string, Cursors>>,
  failed: ReadonlyArray<string>,
  sent: PagedListingSend<Cursors>,
): Readonly<Record<string, Cursors | null>> {
  const next: Record<string, Cursors | null> = { ...nextCursors };
  for (const environmentId of failed) {
    if (!(environmentId in next)) next[environmentId] = sent?.[environmentId] ?? null;
  }
  return next;
}
