import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));

if (args.help || !args["node-id"]) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const nodeId = String(args["node-id"]);
const workspace = resolve(String(args.workspace || rootDir));
const snapshotDir = resolve(String(args["target-dir"] || join(workspace, "data/node-snapshots")));
const label = String(args.label || `com.leo.ai-monitor-hub.${nodeId}`);
const interval = clampInt(args.interval, 120);
const note = args.note ? String(args.note) : "";
const outputPath = args.output ? resolve(String(args.output)) : null;
const nodeBinary = String(args["node-bin"] || preferredNodeBinary());
const scriptPath = resolve(String(args.script || join(workspace, "scripts/report-node-snapshot.mjs")));
const logDir = resolve(String(args["log-dir"] || join(os.homedir(), "Library/Logs/ai-monitor-hub")));
const stdoutPath = join(logDir, `${label}.out.log`);
const stderrPath = join(logDir, `${label}.err.log`);

const programArguments = [
  nodeBinary,
  scriptPath,
  "--node-id",
  nodeId,
  "--target-dir",
  snapshotDir,
];

if (note) {
  programArguments.push("--note", note);
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map((value) => `    <string>${xml(value)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(workspace)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;

if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, plist, "utf8");
  console.log(`Wrote ${label} plist to ${outputPath}`);
} else {
  process.stdout.write(plist);
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
  node scripts/generate-launchd-plist.mjs --node-id studio --output ops/launchd/com.leo.ai-monitor-hub.studio.plist

Options:
  --node-id <id>         Required. Usually studio, m4, or edge-fleet.
  --output <file>        Optional. Write the plist to a file instead of stdout.
  --workspace <dir>      Workspace root containing scripts/report-node-snapshot.mjs.
  --target-dir <dir>     Snapshot directory written by the launch agent.
  --label <label>        launchd label. Default: com.leo.ai-monitor-hub.<node-id>
  --interval <seconds>   StartInterval value. Default: 120
  --note <text>          Static note passed to the snapshot reporter.
  --node-bin <path>      Absolute path to the Node executable.
  --log-dir <dir>        Directory for stdout/stderr log files.
  --help                 Show this message.
`);
}

function clampInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 30) {
    return fallback;
  }
  return parsed;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function preferredNodeBinary() {
  const stableCandidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
  ];

  for (const candidate of stableCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const output = execFileSync("/usr/bin/which", ["node"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output || process.execPath;
  } catch {
    return process.execPath;
  }
}
