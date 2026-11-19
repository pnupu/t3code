import { useAtomValue } from "@effect/atom-react";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  formatDuration,
} from "@t3tools/shared/usageLimits";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings, usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { providerClients } from "../settings/providerDriverMeta";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { barColor } from "../usage/UsageLimits";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { limitTone, PACE_LABEL, UsageRow } from "./ThreadDetailsUsage";

const MAX_RINGS = 4;

const SIZE = 76;
const STROKE = 7;
const STEP = 9;

/** Weekly limits across all environments, as lines or concentric rings that show the room left. */
export function ThreadDetailsWeeklyUsage() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const style = useClientSettings((settings) => settings.threadDetailsWeeklyUsageStyle);
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const windows = collectLimitPools(collectLimitAccounts(presentations), now).flatMap((pool) => {
    const provider = providerClients.get(pool.driver)?.label ?? String(pool.driver);
    const color = barColor(pool.driver);
    return displayLimitWindows(pool)
      .filter((window) => window.kind === "weekly")
      .map((window, index) => ({
        key: `${pool.driver}:${window.id}`,
        // "Weekly · Fable" and "Go · Weekly" keep their qualifier; plain "Weekly" names the provider.
        name: window.label.replace(/^Weekly\s*·\s*|\s*·\s*Weekly$|^Weekly$/i, "") || provider,
        title: `${provider} ${window.label}`,
        // A provider's extra weekly windows turn its hue so each ring reads apart.
        color: index === 0 ? color : `oklch(from ${color} l c calc(h + ${45 * index}))`,
        left: Math.max(0, Math.min(100, window.remainingPercent)),
        window,
      }));
  });
  // lean: more than four rings leave no room in the center; revisit if a fifth weekly pool matters.
  const rings = style === "rings" ? windows.slice(0, MAX_RINGS) : windows;
  if (rings.length === 0) return null;

  const tooltip = (ring: (typeof rings)[number]) => {
    const pooled = ring.window.members.length > 1;
    // A spent pool member's reset can restore nothing; name the next one that does, else the next one.
    const upcoming = ring.window.resets.filter((entry) => entry.at > now);
    const refill = pooled ? upcoming.find((entry) => entry.restoresPercent > 0) : undefined;
    const reset = refill ?? upcoming[0];
    return (
      <>
        <span className="text-foreground">
          {ring.title}: {ring.left}% left
        </span>
        {reset ? (
          <span className="text-muted-foreground">
            {refill ? `+${refill.restoresPercent}% in ` : "Resets in "}
            {formatDuration(reset.at - now)} ·{" "}
            {formatUpcomingTimestamp(new Date(reset.at).toISOString(), timestampFormat, now)}
          </span>
        ) : null}
        {ring.window.pace ? (
          <span className="text-muted-foreground">{PACE_LABEL[ring.window.pace]}</span>
        ) : null}
      </>
    );
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-weekly-usage-heading"
      title="Weekly usage"
      showHeading={false}
    >
      {style === "lines" ? (
        <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
          {rings.map((ring) => (
            <UsageRow
              key={ring.key}
              label={ring.name}
              fill={ring.left}
              color={ring.color}
              tone={limitTone(ring.left)}
              value={`${ring.left}%`}
              ariaLabel={`${ring.title}: ${ring.left}% left`}
              tooltip={tooltip(ring)}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 px-2.5 py-1">
          <svg
            aria-hidden
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="shrink-0 -rotate-90"
          >
            {rings.map((ring, index) => {
              const radius = SIZE / 2 - STROKE / 2 - index * STEP;
              const circumference = 2 * Math.PI * radius;
              const { left } = ring;
              return (
                <g key={ring.key} style={{ color: ring.color }}>
                  <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={STROKE}
                    className="opacity-10"
                  />
                  {left > 0 ? (
                    <circle
                      cx={SIZE / 2}
                      cy={SIZE / 2}
                      r={radius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={STROKE}
                      strokeLinecap="round"
                      // Round caps add half a stroke at each end, so trim the dash to match the percent.
                      // A non-zero dash keeps a small value visible as a cap-sized dot.
                      strokeDasharray={`${
                        left >= 100
                          ? circumference
                          : Math.max(0.01, (circumference * left) / 100 - STROKE)
                      } ${circumference}`}
                      className="opacity-35 transition-[stroke-dasharray] duration-500 ease-out motion-reduce:transition-none"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div className="flex min-w-0 flex-1 flex-col text-xs">
            {rings.map((ring) => {
              const { left } = ring;
              return (
                <Tooltip key={ring.key}>
                  <TooltipTrigger
                    render={
                      <div
                        tabIndex={0}
                        aria-label={`${ring.title}: ${left}% left`}
                        className="flex h-6 cursor-default items-center gap-2 rounded-lg px-1.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
                      />
                    }
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full bg-current opacity-35"
                      style={{ color: ring.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {ring.name}
                    </span>
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        left <= 10
                          ? "text-error-foreground"
                          : left <= 20
                            ? "text-warning-foreground"
                            : "text-foreground/80",
                      )}
                    >
                      {left}%
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup side="left" sideOffset={16}>
                    <div className="flex flex-col gap-0.5">{tooltip(ring)}</div>
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}
    </ThreadDetailsSection>
  );
}
