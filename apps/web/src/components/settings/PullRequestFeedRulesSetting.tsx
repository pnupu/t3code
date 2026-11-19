import type { EnvironmentId } from "@t3tools/contracts";
import { PULL_REQUEST_FEED_RULES } from "@t3tools/client-runtime/pull-request-feed";

import { usePullRequestFeed } from "../pullRequest/usePullRequestFeed";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

/** Every repository's rule in one place; each write covers all writable copies of it. */
export function PullRequestFeedRulesSetting(props: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  const feed = usePullRequestFeed();
  const rows = feed.ruleRows(props.environmentIds);
  return (
    <SettingsRow
      {...searchableSetting("pull-request-feed-rules")}
      description={
        rows.length === 0
          ? "No projects yet."
          : "Each repository's rule. A rule set here applies to every copy of the repository that this connection can change."
      }
    >
      {rows.length === 0 ? null : (
        <ul className="divide-y divide-border pb-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0 text-xs">
                <p className="truncate font-medium text-foreground">{row.name}</p>
                <p className="truncate text-muted-foreground">{row.covers}</p>
                {row.status ? <p className="text-muted-foreground">{row.status}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {row.canReset ? (
                  <SettingResetButton
                    label={`${row.name} feed rule`}
                    tooltip="Use the default rule"
                    onClick={() => feed.resetRowRule(row)}
                  />
                ) : null}
                <Select
                  value={row.rule}
                  disabled={row.copies.every((copy) => copy.access !== "writable")}
                  onValueChange={(value) => {
                    const rule = PULL_REQUEST_FEED_RULES.find((option) => option.value === value);
                    if (rule) feed.setRowRule(row, rule.value);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={`Pull request feed for ${row.name}`}>
                    <SelectValue>
                      {(value: string | null) =>
                        PULL_REQUEST_FEED_RULES.find((option) => option.value === value)?.label ??
                        (row.known ? "Differs" : "Unavailable")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {PULL_REQUEST_FEED_RULES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsRow>
  );
}
