import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const args = parseArgs(process.argv.slice(2));

if (args.help || !args["node-id"]) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const nodeId = String(args["node-id"]);
const targetDir = args["target-dir"] ? resolve(String(args["target-dir"])) : null;
const targetFile = args["target-file"]
  ? resolve(String(args["target-file"]))
  : targetDir
    ? join(targetDir, `${nodeId}.json`)
    : null;

const online = !toBoolean(args.offline, false);
const cpuPercent = args["cpu-percent"] != null ? Number(args["cpu-percent"]) : await estimateCpuPercent();
const latencyMs = args["latency-ms"] != null ? Number(args["latency-ms"]) : undefined;
const memoryUsedPercent = estimateMemoryUsedPercent();
const powerSource = await getPowerSource();
const hostname = safeSystemValue(() => os.hostname(), "unknown-host");
const platform = `${safeSystemValue(() => os.platform(), "unknown")} ${safeSystemValue(() => os.release(), "")}`.trim();
const defaultNote = `${hostname} · ${powerSource}`;

const snapshot = {
  nodeId,
  updatedAt: new Date().toISOString(),
  online,
  cpuPercent: clamp(Number.isFinite(cpuPercent) ? cpuPercent : 0, 0, 999),
  memoryUsedPercent,
  hostname,
  platform,
  note: args.note ? String(args.note) : defaultNote,
};

if (Number.isFinite(latencyMs)) {
  snapshot.latencyMs = clamp(latencyMs, 0, 99999);
}

if (targetFile) {
  await mkdir(dirname(targetFile), { recursive: true });
  await writeFile(targetFile, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(`Wrote snapshot for ${nodeId} to ${targetFile}`);
} else {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/report-node-snapshot.mjs --node-id studio
  node scripts/report-node-snapshot.mjs --node-id m4 --target-dir "${join(rootDir, "data/node-snapshots")}"

Options:
  --node-id <id>          Required. Usually studio, m4, or edge-fleet.
  --target-dir <dir>      Write <dir>/<node-id>.json instead of stdout.
  --target-file <file>    Write to a specific file path.
  --note <text>           Override the human-readable note field.
  --latency-ms <num>      Include a measured latency value.
  --cpu-percent <num>     Override the auto-estimated CPU percent.
  --offline               Mark this snapshot as offline.
  --help                  Show this message.
`);
}

async function estimateCpuPercent() {
  const cpuCount = safeSystemValue(() => os.cpus().length, 1) || 1;
  const loadAvg = safeSystemValue(() => os.loadavg()[0], 0);
  return Math.round((loadAvg / cpuCount) * 100);
}

function estimateMemoryUsedPercent() {
  const total = safeSystemValue(() => os.totalmem(), 0);
  const free = safeSystemValue(() => os.freemem(), 0);
  if (!total) {
    return 0;
  }
  return Math.round(((total - free) / total) * 100);
}

async function getPowerSource() {
  try {
    const { stdout } = await execFileAsync("pmset", ["-g", "batt"], {
      timeout: 2500,
      maxBuffer: 1024 * 1024,
    });
    const firstLine = stdout.trim().split("\n")[0] || "";
    return firstLine.replace("Now drawing from ", "").replaceAll("'", "") || "unknown power";
  } catch {
    return "unknown power";
  }
}

function toBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeSystemValue(reader, fallback) {
  try {
    return reader();
  } catch {
    return fallback;
  }
}
