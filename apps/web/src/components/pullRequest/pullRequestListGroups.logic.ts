import {
  filterPullRequestFeed,
  pullRequestFeedGroup,
  type PullRequestFeedOptions,
} from "@t3tools/client-runtime/pull-request-feed";
import type {
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListResult,
} from "@t3tools/contracts";

import type { PullRequestTabStatusSeed } from "~/components/RightPanelTabs";
import { pullRequestSurfaceId } from "~/rightPanelStore";
import {
  comparePullRequestsByRecency,
  filterPullRequestsByInvolvement,
  groupPullRequestsByInvolvement,
  matchesPullRequestFilters,
  matchesPullRequestQuery,
  partitionPullRequestsWithPriority,
  pullRequestEntryKey,
  pullRequestEntryViewer,
  rankPullRequestMatches,
  type EnvironmentPullRequestEntry,
  type PullRequestPartitionsSnapshot,
} from "./pullRequestList.logic";

export const pullRequestListEntryId = (target: Parameters<typeof pullRequestSurfaceId>[0]) =>
  pullRequestSurfaceId({ ...target, repository: target.repository.toLowerCase() });

/** The held rows narrowed to what the reader asked for, in the groups the list shows. */
export function pullRequestGroups({
  known,
  baseline,
  providers,
  viewers,
  involvement,
  localFilters,
  hasLocalFilters,
  text,
  answeredLocally,
  baselineEmpty,
  held,
  authored,
  reviewing,
  partitionsWanted,
  feed,
}: {
  known: ReadonlyArray<EnvironmentPullRequestEntry>;
  /** The text-free rows already loaded, or undefined when the typed filters cannot vet them. */
  baseline: ReadonlyArray<EnvironmentPullRequestEntry> | undefined;
  providers: PullRequestListResult["providers"];
  viewers: PullRequestListResult["viewers"];
  involvement: PullRequestInvolvement;
  localFilters: PullRequestListFilters;
  hasLocalFilters: boolean;
  text: string;
  answeredLocally: boolean;
  baselineEmpty: boolean;
  held: PullRequestPartitionsSnapshot | undefined;
  authored: ReadonlyArray<EnvironmentPullRequestEntry> | undefined;
  reviewing: ReadonlyArray<EnvironmentPullRequestEntry> | undefined;
  partitionsWanted: boolean;
  /** Project feed rules and hidden pull requests; `hiddenCount` counts hidden rows in this view. */
  feed?: Omit<PullRequestFeedOptions<EnvironmentPullRequestEntry>, "involvement"> & {
    readonly showHidden: boolean;
  };
}) {
  const searchingHosts = new Set(
    providers.flatMap((provider) => (provider.searchesOnHost ? [provider.host] : [])),
  );

  const narrowRows = (rows: ReadonlyArray<EnvironmentPullRequestEntry>) => {
    const involvementEntries = filterPullRequestsByInvolvement(rows, viewers, involvement);
    return hasLocalFilters
      ? involvementEntries.filter((entry) =>
          matchesPullRequestFilters(entry, localFilters, pullRequestEntryViewer(entry, viewers)),
        )
      : involvementEntries;
  };

  const searched = (() => {
    const narrowedEntries = narrowRows(known);
    if (text.length === 0) {
      return narrowedEntries.toSorted(comparePullRequestsByRecency);
    }
    // Host text searches cover fields absent from rows, so do not narrow their matches locally.
    // Filter text locally while results are pending or when the host has no text search.
    const matched = narrowedEntries.filter(
      (entry) =>
        (answeredLocally && searchingHosts.has(entry.host)) || matchesPullRequestQuery(entry, text),
    );
    // Host search matches whole words, so it can miss loaded rows a partial word matches here.
    // Those follow the host's ranked answer rather than reshuffling it.
    const listed = new Set(matched.map(pullRequestEntryKey));
    const missed = narrowRows(baseline ?? []).filter(
      (entry) => !listed.has(pullRequestEntryKey(entry)) && matchesPullRequestQuery(entry, text),
    );
    return missed.length === 0 ? matched : [...matched, ...rankPullRequestMatches(missed, text)];
  })();

  const grouped = (() => {
    if (involvement !== "all") return [{ key: "others" as const, label: "", entries: searched }];
    if (baselineEmpty) {
      return groupPullRequestsByInvolvement(searched, viewers);
    }
    const narrow = (rows: ReadonlyArray<EnvironmentPullRequestEntry> | undefined) =>
      rows === undefined || !hasLocalFilters
        ? rows
        : rows.filter((entry) =>
            matchesPullRequestFilters(entry, localFilters, pullRequestEntryViewer(entry, viewers)),
          );
    const narrowedAuthored = narrow(partitionsWanted ? (authored ?? held?.authored) : undefined);
    const narrowedReviewing = narrow(partitionsWanted ? (reviewing ?? held?.reviewing) : undefined);
    if (narrowedAuthored === undefined || narrowedReviewing === undefined) {
      return groupPullRequestsByInvolvement(searched, viewers);
    }
    return partitionPullRequestsWithPriority(searched, narrowedAuthored, narrowedReviewing);
  })();

  // lean: projects ruled "authored" or "reviewing" are still read by the main list, and their
  // other rows drop here, which can leave a short page. Revisit if users report sparse pages.
  const { groups, hiddenCount, ruledOutCount } =
    feed === undefined
      ? { groups: grouped, hiddenCount: 0, ruledOutCount: 0 }
      : filterPullRequestFeed(grouped, {
          ...feed,
          involvement,
          // Rows a later page brings land in Others when the first-page partitions miss them.
          groupOf: (entry) => pullRequestFeedGroup(entry, pullRequestEntryViewer(entry, viewers)),
        });
  const entries =
    groups === grouped
      ? searched
      : (() => {
          const kept = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.url)));
          return searched.filter((entry) => kept.has(entry.url));
        })();

  const listedPullRequestTabStatuses: Record<string, PullRequestTabStatusSeed> = Object.fromEntries(
    entries.map((entry) => [
      pullRequestSurfaceId(entry),
      {
        state: entry.state,
        isDraft: entry.isDraft,
      },
    ]),
  );

  const entriesByStatsKey: ReadonlyMap<string, EnvironmentPullRequestEntry> = new Map(
    groups.flatMap((group) =>
      group.entries.map((entry) => [pullRequestEntryKey(entry), entry] as const),
    ),
  );
  const heldPullRequestsBySurface = new Map(
    groups.flatMap((group) =>
      group.entries.map((entry) => [pullRequestListEntryId(entry), entry] as const),
    ),
  );
  return {
    entries,
    listedPullRequestTabStatuses,
    groups,
    hiddenCount,
    ruledOutCount,
    entriesByStatsKey,
    heldPullRequestsBySurface,
  };
}
