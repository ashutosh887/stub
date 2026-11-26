import after from "@/measurements/wa-review/dsql-race-after.json";
import before from "@/measurements/wa-review/dsql-race-before.json";

interface TimelineStep {
  ms: number;
  committed: boolean;
  code: string | null;
  balanceUsd: string;
}

interface RaceRun {
  connectedAs: string;
  checkConstraint: boolean;
  writers: number;
  startUsd: string;
  amountUsd: string;
  committed: number;
  refused: Record<string, number>;
  finalMicro: string;
  timeline: TimelineStep[];
}

interface RaceFile {
  driver: string;
  reports: RaceRun[];
}

export interface RacePoint {
  write: number;
  usd: number;
  low: number;
  high: number;
  committedRuns: number;
  codes: string[];
}

export interface RaceSeries {
  runs: number;
  points: RacePoint[];
  finals: number[];
  committed: number[];
  refused: number[];
  codes: string[];
}

export interface RaceSummary {
  driver: string;
  connectedAs: string[];
  writers: number;
  startUsd: number;
  amountUsd: number;
  before: RaceSeries;
  after: RaceSeries;
  overspentRuns: number;
  overspendUsd: number;
}

const usd = (text: string): number => {
  const value = Number(text.replace(/[$,]/g, ""));
  if (!Number.isFinite(value)) throw new Error(`not a dollar amount: ${text}`);
  return value;
};

const micro = (text: string): number => Number(BigInt(text)) / 1_000_000;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function series(file: RaceFile): RaceSeries {
  const runs = file.reports;
  if (runs.length === 0) throw new Error("a race file has no runs");
  const ordered = runs.map((run) => [...run.timeline].sort((a, b) => a.ms - b.ms));
  const length = Math.max(...ordered.map((t) => t.length));
  const start = runs.map((run) => usd(run.startUsd));
  const points: RacePoint[] = [
    {
      write: 0,
      usd: median(start),
      low: Math.min(...start),
      high: Math.max(...start),
      committedRuns: runs.length,
      codes: [],
    },
  ];
  for (let i = 0; i < length; i++) {
    const steps = ordered.map((t) => t[i]).filter((s): s is TimelineStep => s !== undefined);
    const values = steps.map((s) => usd(s.balanceUsd));
    points.push({
      write: i + 1,
      usd: median(values),
      low: Math.min(...values),
      high: Math.max(...values),
      committedRuns: steps.filter((s) => s.committed).length,
      codes: [...new Set(steps.flatMap((s) => (s.code ? [s.code] : [])))],
    });
  }
  return {
    runs: runs.length,
    points,
    finals: runs.map((run) => micro(run.finalMicro)),
    committed: runs.map((run) => run.committed),
    refused: runs.map((run) => Object.values(run.refused).reduce((sum, n) => sum + n, 0)),
    codes: [...new Set(runs.flatMap((run) => Object.keys(run.refused)))].sort(),
  };
}

function summarize(beforeFile: RaceFile, afterFile: RaceFile): RaceSummary {
  const b = series(beforeFile);
  const a = series(afterFile);
  const first = beforeFile.reports[0];
  const overspend = b.finals.map((f) => (f < 0 ? -f : 0));
  return {
    driver: beforeFile.driver,
    connectedAs: [
      ...new Set([...beforeFile.reports, ...afterFile.reports].map((r) => r.connectedAs)),
    ],
    writers: first.writers,
    startUsd: usd(first.startUsd),
    amountUsd: usd(first.amountUsd),
    before: b,
    after: a,
    overspentRuns: overspend.filter((o) => o > 0).length,
    overspendUsd: overspend.reduce((sum, o) => sum + o, 0),
  };
}

export const RACE = summarize(before as RaceFile, after as RaceFile);

export const RACE_FILES = {
  before: "measurements/wa-review/dsql-race-before.json",
  after: "measurements/wa-review/dsql-race-after.json",
};

const WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

export const inWords = (n: number): string => WORDS[n] ?? String(n);

export function dollars(value: number): string {
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "-" : ""}$${abs}`;
}

const same = (values: number[]): boolean => values.every((v) => v === values[0]);

function range(values: number[], format: (n: number) => string = String): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? format(low) : `${format(low)} to ${format(high)}`;
}

export function raceSentences(race: RaceSummary = RACE): { before: string; after: string } {
  const { before: b, after: a } = race;
  const lowest = Math.min(...b.finals);
  const end = same(b.finals) ? `to ${dollars(lowest)}` : `as low as ${dollars(lowest)}`;
  const every =
    race.overspentRuns === b.runs ? "in every run" : `in ${race.overspentRuns} of ${b.runs} runs`;
  const beforeLine = `On the old schema the same ${inWords(race.writers)} writes took a ${dollars(race.startUsd)} budget ${end} ${every} (${race.overspentRuns} of ${b.runs} runs, ${dollars(race.overspendUsd)} accepted that was not there).`;
  const refused = same(a.refused) ? inWords(a.refused[0]) : range(a.refused);
  const codes = a.codes.length > 0 ? ` with ${a.codes.join(" and ")}` : "";
  const held = a.finals.filter((f) => f >= 0).length;
  const finals = same(a.finals)
    ? `the balance stops at ${dollars(a.finals[0])}`
    : `the balance ends at ${range(a.finals, dollars)}`;
  const runs =
    held === a.runs
      ? `in all ${a.runs} runs`
      : `and stays at or above $0.00 in ${held} of ${a.runs} runs`;
  const afterLine = `Now the database refuses ${refused} of them${codes}, and ${finals} ${runs}.`;
  return { before: beforeLine, after: afterLine };
}

export const driverName = (driver: string): string =>
  driver === "dsql" ? "Aurora DSQL" : driver === "postgres" ? "Postgres" : driver;
