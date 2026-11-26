import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RACE, dollars, driverName, inWords } from "@/lib/race";

export const alt = "Stub proof: the same race took a budget negative before, and stops at zero now";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#07090d";
const FG = "#eef1f5";
const DIM = "#98a4b2";
const MUTE = "#5e6a77";
const LINE = "#1e2630";
const DENY = "#e5575c";
const COMMIT = "#46c08a";
const BRAND = "#e4b363";

const CHART = { width: 480, height: 300, pad: 16 };

function plot(points: { write: number; usd: number }[], low: number, high: number, last: number) {
  const w = CHART.width - CHART.pad * 2;
  const h = CHART.height - CHART.pad * 2;
  return points.map((p) => ({
    x: CHART.pad + (p.write / last) * w,
    y: CHART.pad + ((high - p.usd) / (high - low)) * h,
  }));
}

const d = (points: { x: number; y: number }[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

export default async function ProofImage() {
  const logo = await readFile(join(process.cwd(), "public", "logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  const { before, after } = RACE;
  const values = [...before.points, ...after.points].flatMap((p) => [p.low, p.high, 0]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const last = Math.max(before.points.length, after.points.length) - 1;
  const b = plot(before.points, low, high, last);
  const a = plot(after.points, low, high, last);
  const zero = plot([{ write: 0, usd: 0 }], low, high, last)[0].y;
  const beforeEnd = before.points[before.points.length - 1].usd;
  const afterEnd = after.points[after.points.length - 1].usd;
  const refused = Math.max(...after.refused);
  const codes = after.codes.join(" ");
  const words = inWords(RACE.writers);
  const writers = words[0].toUpperCase() + words.slice(1);
  const identical = [before, after].every(
    (series) =>
      series.points.every((p) => p.low === p.high) &&
      series.finals.every((f) => f === series.finals[0]),
  );

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: INK,
        padding: "48px 64px",
        fontFamily: "Georgia, serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={logoSrc} alt="" width={56} height={56} />
          <span style={{ fontSize: 34, fontWeight: 600, color: FG }}>Stub</span>
        </div>
        <span style={{ fontSize: 24, color: BRAND }}>trystub.vercel.app/proof</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 560, flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 52,
              whiteSpace: "nowrap",
              fontWeight: 600,
              color: FG,
              lineHeight: 1.06,
            }}
          >
            <span>The database</span>
            <span>refuses the overspend.</span>
          </div>
          <div style={{ fontSize: 24, color: DIM, marginTop: 20, lineHeight: 1.35 }}>
            {`${writers} writers, one ${dollars(RACE.startUsd)} budget, ${driverName(RACE.driver)}.`}
          </div>
          <div style={{ display: "flex", gap: 40, marginTop: 32 }}>
            <End
              color={DENY}
              label="Before"
              value={dollars(beforeEnd)}
              note={`${Math.min(...before.committed)} of ${RACE.writers} committed`}
            />
            <End
              color={COMMIT}
              label="After"
              value={dollars(afterEnd)}
              note={`${refused} refused ${codes}`}
            />
          </div>
        </div>

        <svg
          width={CHART.width}
          height={CHART.height}
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        >
          <path
            d={`${d(b.map((p) => ({ x: p.x, y: Math.max(p.y, zero) })))} L${b[b.length - 1].x},${zero} L${b[0].x},${zero} Z`}
            fill={DENY}
            fillOpacity={0.14}
          />
          <line
            x1={CHART.pad}
            x2={CHART.width - CHART.pad}
            y1={zero}
            y2={zero}
            stroke={DIM}
            strokeWidth={2}
          />
          <line
            x1={CHART.pad}
            x2={CHART.width - CHART.pad}
            y1={CHART.height - CHART.pad}
            y2={CHART.height - CHART.pad}
            stroke={LINE}
            strokeWidth={2}
          />
          <path
            d={d(b)}
            fill="none"
            stroke={DENY}
            strokeWidth={5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={d(a)}
            fill="none"
            stroke={COMMIT}
            strokeWidth={5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {b.map((p, i) => (
            <circle
              key={`b${i}`}
              cx={p.x}
              cy={p.y}
              r={7}
              fill={DENY}
              stroke={INK}
              strokeWidth={3}
            />
          ))}
          {a.map((p, i) => {
            const point = after.points[i];
            const hollow = point.write > 0 && point.committedRuns < after.runs;
            return (
              <circle
                key={`a${i}`}
                cx={p.x}
                cy={p.y}
                r={hollow ? 7.5 : 7}
                fill={hollow ? INK : COMMIT}
                stroke={hollow ? COMMIT : INK}
                strokeWidth={3}
              />
            );
          })}
        </svg>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 22, color: MUTE }}>
        <div style={{ width: 40, height: 3, background: BRAND }} />
        <span>
          {`Running balance after each write. ${before.runs} runs before, ${after.runs} after${identical ? ", every run the same" : ""}.`}
        </span>
      </div>
    </div>,
    { ...size },
  );
}

function End({
  color,
  label,
  value,
  note,
}: {
  color: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 22, color: DIM }}>
        <div style={{ width: 22, height: 5, borderRadius: 3, background: color }} />
        <span>{label}</span>
      </div>
      <span style={{ fontSize: 64, fontWeight: 600, color: FG, marginTop: 4 }}>{value}</span>
      <span style={{ fontSize: 20, color: MUTE, marginTop: 2 }}>{note}</span>
    </div>
  );
}
