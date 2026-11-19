import { useAtomValue } from "@effect/atom-react";
import {
  PULL_REQUEST_FEED_RULES,
  pullRequestFeedRuleRows,
  pullRequestFeedRuleTargets,
  type PullRequestFeedRuleRow,
} from "@t3tools/client-runtime/pull-request-feed";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { Menu } from "../../../components/ui/Menu";
import { useProjects } from "../../../state/entities";
import { useEnvironments } from "../../../state/environments";
import { environmentServerConfigsAtom } from "../../../state/server";
import { useEnvironmentsWithScope } from "../../../state/session";
import {
  planMobileScopedSettingsClear,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
} from "../settings-scoped-server";
import type { SettingsTarget } from "../settings-environment-filter";
import { useSettingsWriter } from "../useSettingsWriter";
import { SettingsSection } from "./SettingsSection";

const DEFAULT_ACTION = "default";

/**
 * Every repository's feed rule; a pick applies to every writable copy of the repository. It reads
 * cached settings, so it stays useful while environments are offline.
 */
export function PullRequestFeedRulesSection(props: {
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
  readonly targets: readonly SettingsTarget[];
}) {
  const { environments } = useEnvironments();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const projects = useProjects();
  const writeSettings = useSettingsWriter();
  const writable = useEnvironmentsWithScope(props.targets, AuthSettingsWriteScope);
  const environmentOf = (environmentId: EnvironmentId) => {
    const environment = environments.find((candidate) => candidate.environmentId === environmentId);
    const config = configs.get(environmentId);
    if (!environment || !config) return undefined;
    return {
      label: environment.label,
      settings: config.settings,
      connected: environment.connection.phase === "connected",
      capable: config.environment.capabilities.pullRequestFeed === true,
      writeGranted: writable.has(environmentId),
      managedPolicy: config.managedPolicy,
    };
  };
  const rows = pullRequestFeedRuleRows(
    projects.filter(
      (project) => props.selectedIds === null || props.selectedIds.has(project.environmentId),
    ),
    environmentOf,
  );
  if (rows.length === 0) return null;

  type Row = (typeof rows)[number];
  const pick = (row: Row, action: string) => {
    const reset = action === DEFAULT_ACTION;
    const rule = PULL_REQUEST_FEED_RULES.find((option) => option.value === action)?.value;
    if (!reset && rule === undefined) return;
    const picked = reset ? null : rule!;
    const members = pullRequestFeedRuleTargets(row, picked);
    if (members.length === 0) return;
    // The copies are chosen now; each save rebuilds their entries from the settings it starts
    // from, so a save queued behind another keeps that one's keys.
    void writeSettings(props.targets, (current) => {
      const targets = resolveMobileSettingsTargets(current, members);
      return picked === null
        ? planMobileScopedSettingsClear(targets, ["pullRequestFeed"])
        : planMobileScopedSettingsPatch(targets, true, { pullRequestFeed: picked });
    });
  };

  return (
    <SettingsSection
      title="Repository feed rules"
      footer="A rule picked here applies to every copy of the repository that this connection can change."
    >
      {rows.map((row, index) => (
        <RuleRow
          key={row.key}
          row={row}
          separated={index > 0}
          disabled={row.copies.every((copy) => copy.access !== "writable")}
          onPick={(action) => pick(row, action)}
        />
      ))}
    </SettingsSection>
  );
}

function RuleRow<Project>(props: {
  readonly row: PullRequestFeedRuleRow<Project>;
  readonly separated: boolean;
  readonly disabled: boolean;
  readonly onPick: (action: string) => void;
}) {
  const { row } = props;
  const value =
    PULL_REQUEST_FEED_RULES.find((option) => option.value === row.rule)?.label ??
    (row.known ? "Differs" : "Unavailable");
  const content = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.name}, ${value}`}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      className={
        props.separated
          ? "min-h-14 gap-0.5 border-t border-border-subtle px-4 py-3 active:opacity-70"
          : "min-h-14 gap-0.5 px-4 py-3 active:opacity-70"
      }
    >
      <View className="flex-row items-center gap-3">
        <Text textRole="body" className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
          {row.name}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
          {value}
        </Text>
        {props.disabled ? null : (
          <SymbolView
            name="chevron.down"
            size={14}
            tintColorClassName="accent-chevron"
            type="monochrome"
          />
        )}
      </View>
      <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
        {row.covers}
      </Text>
      {row.status ? (
        <Text textRole="footnote" className="text-foreground-muted">
          {row.status}
        </Text>
      ) : null}
    </Pressable>
  );
  if (props.disabled) return content;
  return (
    <Menu
      actions={[
        ...PULL_REQUEST_FEED_RULES.map((option) => ({
          id: option.value,
          title: option.label,
          state: row.rule === option.value ? ("on" as const) : ("off" as const),
        })),
        ...(row.canReset ? [{ id: DEFAULT_ACTION, title: "Use the default rule" }] : []),
      ]}
      onPressAction={({ nativeEvent }) => props.onPick(nativeEvent.event)}
    >
      {content}
    </Menu>
  );
}
