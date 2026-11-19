import {
  PULL_REQUEST_FEED_RULES,
  pullRequestFeedRuleRows,
  type PullRequestFeedRuleRow,
} from "@t3tools/client-runtime/pull-request-feed";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { Menu } from "../../../components/ui/Menu";
import { useProjects } from "../../../state/entities";
import { useEnvironments } from "../../../state/environments";
import { readEnvironmentScope } from "../../../state/session";
import {
  planMobileScopedSettingsClear,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
} from "../settings-scoped-server";
import type { SettingsTarget } from "../settings-environment-filter";
import { useSettingsWriter } from "../useSettingsWriter";
import { SettingsSection } from "./SettingsSection";

const DEFAULT_ACTION = "default";

/** Every repository's feed rule; a pick applies to every writable copy of the repository. */
export function PullRequestFeedRulesSection(props: {
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
  readonly targets: readonly SettingsTarget[];
}) {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const writeSettings = useSettingsWriter();
  const [pending, setPending] = useState(false);
  const rows = pullRequestFeedRuleRows(
    projects.filter(
      (project) => props.selectedIds === null || props.selectedIds.has(project.environmentId),
    ),
    (environmentId) => {
      const environment = environments.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      const config = environment?.serverConfig;
      if (!environment || !config) return undefined;
      return {
        label: environment.label,
        settings: config.settings,
        access:
          environment.connection.phase !== "connected"
            ? "disconnected"
            : config.environment.capabilities.pullRequestFeed !== true
              ? "outdated"
              : readEnvironmentScope(environmentId, AuthSettingsWriteScope)
                ? "writable"
                : "read-only",
      };
    },
  );
  if (rows.length === 0) return null;

  type Row = (typeof rows)[number];
  const pick = (row: Row, action: string) => {
    const reset = action === DEFAULT_ACTION;
    const rule = PULL_REQUEST_FEED_RULES.find((option) => option.value === action)?.value;
    if (pending || (!reset && rule === undefined)) return;
    const members = row.copies.flatMap((copy) =>
      copy.access === "writable" && (!reset || copy.overridden) ? [copy.project] : [],
    );
    const targets = resolveMobileSettingsTargets(props.targets, members);
    const writes = reset
      ? planMobileScopedSettingsClear(targets, ["pullRequestFeed"])
      : planMobileScopedSettingsPatch(targets, true, { pullRequestFeed: rule! });
    if (writes.length === 0) return;
    setPending(true);
    void writeSettings(targets, writes).finally(() => setPending(false));
  };

  return (
    <SettingsSection
      title="Repository feed rules"
      footer="A rule picked here applies to every copy of the repository."
    >
      {rows.map((row, index) => (
        <RuleRow
          key={row.key}
          row={row}
          separated={index > 0}
          disabled={pending || row.copies.every((copy) => copy.access !== "writable")}
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
    PULL_REQUEST_FEED_RULES.find((option) => option.value === row.rule)?.label ?? "Differs";
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
