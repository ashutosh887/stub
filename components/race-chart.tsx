"use client";

import { useEffect, useRef, useState } from "react";
import { Stamp } from "@/components/site-kit";
import type { RacePoint, RaceSummary } from "@/lib/race";

const HEIGHT = 300;
const PAD = { top: 20, right: 76, bottom: 44, left: 48 };
const DENY = "var(--color-deny)";
const COMMIT = "var(--color-commit)";
const SURFACE = "var(--color-surface)";

const money = (value: number, cents = true): string => {
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return `${value < 0 ? "-" : ""}$${abs}`;
};

function scale(low: number, high: number): { ticks: number[]; low: number; high: number } {
  const span = high - low || 1;
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => span / s <= 6) ?? Math.ceil(span / 6);
  const top = Math.ceil(high / step) * step;
  const bottom = Math.floor(low / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top; v += step) ticks.push(v);
  return { ticks, low: bottom, high: top };
}

function path(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function outcome(point: RacePoint, runs: number): string {
  if (point.write === 0) return `${money(point.usd)} budget`;
  const balance =
    point.low === point.high ? money(point.usd) : `${money(point.low)} to ${money(point.high)}`;
  if (point.committedRuns === runs) return `${balance}, committed`;
  const codes = point.codes.join(", ") || "no code";
  if (point.committedRuns === 0) return `${balance}, refused ${codes}`;
  return `${balance}, committed in ${point.committedRuns} of ${runs} runs, else refused ${codes}`;
}

export function RaceChart({ race }: { race: RaceSummary }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { before, after } = race;
  const count = Math.max(before.points.length, after.points.length);
  const values = [...before.points, ...after.points].flatMap((p) => [p.low, p.high, 0]);
  const { ticks: yTicks, low: yLow, high: yHigh } = scale(Math.min(...values), Math.max(...values));
  const narrow = width < 480;
  const right = narrow ? 64 : PAD.right;
  const plotW = Math.max(120, width - PAD.left - right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (write: number) => PAD.left + (write / (count - 1)) * plotW;
  const y = (usd: number) => PAD.top + ((yHigh - usd) / (yHigh - yLow)) * plotH;

  const beforeXY = before.points.map((p) => ({ x: x(p.write), y: y(p.usd) }));
  const afterXY = after.points.map((p) => ({ x: x(p.write), y: y(p.usd) }));
  const zero = y(0);
  const overspend = `${path(beforeXY.map((p) => ({ x: p.x, y: Math.max(p.y, zero) })))} L${beforeXY[beforeXY.length - 1].x},${zero} L${beforeXY[0].x},${zero} Z`;
  const band = (points: RacePoint[]) =>
    points.some((p) => p.low !== p.high)
      ? `${path(points.map((p) => ({ x: x(p.write), y: y(p.high) })))} ${[...points]
          .reverse()
          .map((p) => `L${x(p.write).toFixed(1)},${y(p.low).toFixed(1)}`)
          .join(" ")} Z`
      : null;
  const beforeBand = band(before.points);
  const afterBand = band(after.points);

  const refusedWrites = after.points.filter((p) => p.write > 0 && p.committedRuns === 0);
  const firstRefused = refusedWrites[0];
  const lastRefused = refusedWrites[refusedWrites.length - 1];
  const stampX = firstRefused ? (x(firstRefused.write) + x(lastRefused.write)) / 2 : 0;
  const stampCode = after.codes.join(" ");
  const beforeEnd = before.points[before.points.length - 1];
  const afterEnd = after.points[after.points.length - 1];

  const pick = (clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    const raw = ((clientX - box.left - PAD.left) / plotW) * (count - 1);
    setActive(Math.min(count - 1, Math.max(0, Math.round(raw))));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(count - 1, Math.max(0, (a ?? (step > 0 ? -1 : count)) + step)));
    } else if (e.key === "Escape") setActive(null);
  };

  const tipLeft = active === null ? 0 : Math.min(Math.max(x(active) - 110, 0), width - 220);
  const label = (write: number) => (write === 0 ? "Start" : String(write));

  return (
    <div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-dim">
        <li className="flex items-center gap-2">
          <Key color={DENY} />
          Before: no CHECK, {inRuns(before.committed)} of {race.writers} committed
        </li>
        <li className="flex items-center gap-2">
          <Key color={COMMIT} />
          After: CHECK validated, {inRuns(after.committed)} committed, {inRuns(after.refused)}{" "}
          refused
        </li>
        <li className="flex items-center gap-2">
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill={SURFACE} stroke={COMMIT} strokeWidth="2" />
          </svg>
          Refused write, balance unchanged
        </li>
      </ul>

      <div
        ref={frame}
        className="relative mt-5 touch-pan-y select-none"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          aria-label={`Running balance after each of ${race.writers} writes. Before: ends at ${money(beforeEnd.usd)}. After: ends at ${money(afterEnd.usd)}. Use the arrow keys to step through the writes.`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="block overflow-visible rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "var(--color-fg-dim)" : "var(--color-line)"}
                strokeWidth={t === 0 ? 1.5 : 1}
              />
              <text
                x={PAD.left - 10}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-fg-mute font-mono text-[11px] [font-variant-numeric:tabular-nums]"
              >
                {money(t, false)}
              </text>
            </g>
          ))}

          {before.points.map((p) => (
            <text
              key={p.write}
              x={x(p.write)}
              y={HEIGHT - PAD.bottom + 20}
              textAnchor="middle"
              className="fill-fg-mute font-mono text-[11px] [font-variant-numeric:tabular-nums]"
            >
              {narrow && p.write === 0 ? "0" : label(p.write)}
            </text>
          ))}
          <text
            x={PAD.left + plotW / 2}
            y={HEIGHT - 4}
            textAnchor="middle"
            className="fill-fg-mute text-[12px]"
          >
            Writes, in the order they finished
          </text>

          <path d={overspend} fill={DENY} opacity={0.12} />
          {beforeBand && <path d={beforeBand} fill={DENY} opacity={0.18} />}
          {afterBand && <path d={afterBand} fill={COMMIT} opacity={0.18} />}

          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--color-fg-mute)"
              strokeWidth={1}
            />
          )}

          <path
            d={path(beforeXY)}
            fill="none"
            stroke={DENY}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={path(afterXY)}
            fill="none"
            stroke={COMMIT}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {before.points.map((p, i) => (
            <circle
              key={`b${p.write}`}
              cx={beforeXY[i].x}
              cy={beforeXY[i].y}
              r={active === p.write ? 5.5 : 4}
              fill={DENY}
              stroke={SURFACE}
              strokeWidth={2}
            />
          ))}
          {after.points.map((p, i) => {
            const refused = p.write > 0 && p.committedRuns < after.runs;
            return (
              <circle
                key={`a${p.write}`}
                cx={afterXY[i].x}
                cy={afterXY[i].y}
                r={active === p.write ? 5.5 : refused ? 4.5 : 4}
                fill={refused ? SURFACE : COMMIT}
                stroke={refused ? COMMIT : SURFACE}
                strokeWidth={2}
              />
            );
          })}

          <EndLabel
            x={x(beforeEnd.write) + 10}
            y={y(beforeEnd.usd)}
            name="Before"
            value={money(beforeEnd.usd)}
          />
          <EndLabel
            x={x(afterEnd.write) + 10}
            y={y(afterEnd.usd)}
            name="After"
            value={money(afterEnd.usd)}
          />
        </svg>

        {firstRefused && stampCode && (
          <div
            className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1"
            style={{ left: stampX, top: zero - (narrow ? 14 : 22) }}
          >
            <Stamp code={stampCode} delay={0.5} className={narrow ? "text-xs" : "text-sm"} />
            <span className="whitespace-nowrap text-xs text-fg-dim">
              writes {firstRefused.write} to {lastRefused.write}
            </span>
          </div>
        )}

        {active !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-[220px] rounded-md border border-line-bright bg-surface-2 px-3 py-2.5 text-xs shadow-[0_20px_40px_-20px_rgba(0,0,0,0.9)]"
            style={{ left: tipLeft }}
            aria-live="polite"
          >
            <div className="font-medium text-fg">
              {active === 0 ? "Before the race" : `Write ${active} of ${count - 1}`}
            </div>
            <TipRow color={DENY} name="Before" text={outcome(before.points[active], before.runs)} />
            <TipRow color={COMMIT} name="After" text={outcome(after.points[active], after.runs)} />
          </div>
        )}
      </div>

      <details className="group mt-4 text-sm">
        <summary className="cursor-pointer text-fg-dim transition-colors hover:text-fg">
          Show the numbers
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[22rem] border-y border-line-bright text-left [font-variant-numeric:tabular-nums]">
            <thead className="text-fg-mute">
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-normal">Write</th>
                <th className="py-2 pr-4 font-normal">Before</th>
                <th className="py-2 font-normal">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {Array.from({ length: count }, (_, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-4 text-fg-mute">{label(i)}</td>
                  <td className="py-1.5 pr-4 text-fg">{outcome(before.points[i], before.runs)}</td>
                  <td className="py-1.5 text-fg">{outcome(after.points[i], after.runs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function inRuns(values: number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? String(low) : `${low} to ${high}`;
}

function Key({ color }: { color: string }) {
  return (
    <svg width="22" height="10" aria-hidden="true">
      <line x1="1" x2="21" y1="5" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="11" cy="5" r="3.5" fill={color} />
    </svg>
  );
}

function EndLabel({ x, y, name, value }: { x: number; y: number; name: string; value: string }) {
  return (
    <text x={x} y={y} className="text-[12px]">
      <tspan x={x} dy="-0.2em" className="fill-fg-mute">
        {name}
      </tspan>
      <tspan x={x} dy="1.15em" className="fill-fg font-mono text-[13px] font-semibold">
        {value}
      </tspan>
    </text>
  );
}

function TipRow({ color, name, text }: { color: string; name: string; text: string }) {
  return (
    <div className="mt-1.5 grid grid-cols-[10px_minmax(0,1fr)] items-start gap-2">
      <span className="mt-1 h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-fg-dim">
        <span className="text-fg">{name}</span> {text}
      </span>
    </div>
  );
}
