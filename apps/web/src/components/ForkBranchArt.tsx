import { useId } from "react";

const FORK_COMMITS: ReadonlyArray<{ cx: number; cy: number }> = [
  { cx: 28, cy: 52 },
  { cx: 68, cy: 52 },
  { cx: 112, cy: 52 },
  { cx: 176, cy: 52 },
  { cx: 252, cy: 52 },
  { cx: 340, cy: 52 },
  { cx: 164, cy: 26 },
  { cx: 186, cy: 26 },
  { cx: 230, cy: 26 },
  { cx: 220, cy: 9 },
  { cx: 310, cy: 74 },
  { cx: 362, cy: 74 },
];

const FORK_BRANCH_HEADS: ReadonlyArray<{ cx: number; cy: number; labelWidth: number }> = [
  { cx: 262, cy: 26, labelWidth: 22 },
  { cx: 244, cy: 9, labelWidth: 16 },
];

export function ForkBranchArt({ compact = false }: { compact?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const paperId = `${idPrefix}-stage-fork-paper`;
  const glowId = `${idPrefix}-stage-fork-glow`;
  const emberGlowId = `${idPrefix}-stage-fork-glow-ember`;
  const dotsId = `${idPrefix}-stage-fork-dots`;
  const glowsId = `${idPrefix}-stage-fork-glows`;
  const graphId = `${idPrefix}-stage-fork-graph`;

  return (
    <svg
      data-stage-art="fork"
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? "96 0 8192 96" : "0 0 8192 96"}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={paperId}
          x1="60"
          y1="0"
          x2="220"
          y2="96"
          gradientUnits="userSpaceOnUse"
          spreadMethod="reflect"
        >
          <stop style={{ stopColor: "var(--stage-fork-bottom)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--stage-fork-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--stage-fork-top)" }} />
        </linearGradient>
        <radialGradient
          id={glowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(228 12) rotate(137) scale(120 84)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: "var(--stage-fork-highlight)" }} stopOpacity="0.4" />
          <stop
            offset="0.52"
            style={{ stopColor: "var(--stage-fork-secondary)" }}
            stopOpacity="0.16"
          />
          <stop offset="1" style={{ stopColor: "var(--stage-fork-bottom)" }} stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={emberGlowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(548 40) rotate(166) scale(156 92)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: "var(--stage-fork-secondary)" }} stopOpacity="0.3" />
          <stop offset="1" style={{ stopColor: "var(--stage-fork-bottom)" }} stopOpacity="0" />
        </radialGradient>
        <pattern id={dotsId} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="0.6" style={{ fill: "var(--stage-fork-line)" }} opacity="0.22" />
        </pattern>
        <pattern id={glowsId} width="768" height="96" patternUnits="userSpaceOnUse">
          <rect width="768" height="96" fill={`url(#${glowId})`} />
          <rect width="768" height="96" fill={`url(#${emberGlowId})`} />
        </pattern>
        <pattern id={graphId} width="384" height="96" patternUnits="userSpaceOnUse">
          <g
            style={{ stroke: "var(--stage-fork-line)" }}
            strokeLinecap="round"
            strokeOpacity="0.62"
            strokeWidth="1.1"
          >
            <path d="M0 52H384" />
            <path d="M112 52C134 52 138 26 160 26H262" />
            <path d="M186 26C200 26 204 9 218 9H244" />
            <path d="M252 52C272 52 276 74 296 74H384" />
            <path d="M0 74H24C44 74 48 52 68 52" />
          </g>
          <g style={{ fill: "var(--stage-fork-line)" }} fillOpacity="0.92">
            {FORK_COMMITS.map((commit) => (
              <circle key={`${commit.cx}-${commit.cy}`} cx={commit.cx} cy={commit.cy} r="2.6" />
            ))}
          </g>
          <g style={{ stroke: "var(--stage-fork-line)" }} strokeWidth="1.1">
            {FORK_BRANCH_HEADS.map((head) => (
              <g key={`${head.cx}-${head.cy}`}>
                <circle
                  cx={head.cx}
                  cy={head.cy}
                  r="4.2"
                  style={{ fill: "var(--stage-fork-bottom)" }}
                  strokeOpacity="0.92"
                />
                <rect
                  x={head.cx + 9}
                  y={head.cy - 4}
                  width={head.labelWidth}
                  height="8"
                  rx="4"
                  strokeOpacity="0.5"
                  strokeWidth="0.8"
                />
              </g>
            ))}
          </g>
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${paperId})`} />
      <rect width="100%" height="96" fill={`url(#${glowsId})`} />
      <rect width="100%" height="96" fill={`url(#${dotsId})`} />
      <rect width="100%" height="96" fill={`url(#${graphId})`} />
    </svg>
  );
}
