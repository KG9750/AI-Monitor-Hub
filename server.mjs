import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, existsSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const modulePath = fileURLToPath(import.meta.url);
const rootDir = dirname(modulePath);
const staticRoot = resolve(rootDir, process.argv[2] || ".");
const dataDir = join(rootDir, "data");
const runtimeStatePath = join(dataDir, "runtime-state.json");
const remoteSnapshotPath = join(dataDir, "remote-node-snapshots.json");
const nodeSnapshotDir = join(dataDir, "node-snapshots");
const port = Number(process.env.PORT || 4173);
const refreshWindowMs = 5 * 60 * 1000;

await ensureDataDirectory();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return sendJson(response, 200, await buildDashboardPayload());
    }

    if (url.pathname === "/api/docker/status" && request.method === "GET") {
      return sendJson(response, 200, await getDockerStatusSummary());
    }

    if (url.pathname === "/api/docker/start" && request.method === "POST") {
      const runtimeState = await loadRuntimeState();
      const docker = await startDockerDesktop();
      runtimeState.activityLog.unshift(
        createActivity({
          kind: "docker",
          status: docker.running ? "running" : "starting",
          badge: "DOCKER",
          title: docker.running ? "Docker is running" : "Docker start requested",
          body: docker.running
            ? "Docker daemon is reachable and container control is available."
            : docker.detail || "Docker Desktop start command was sent. It may need a moment to become ready.",
        }),
      );
      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, await buildDashboardPayload(runtimeState));
    }

    if (url.pathname === "/api/docker/stop" && request.method === "POST") {
      const runtimeState = await loadRuntimeState();
      const docker = await stopDockerDesktop();
      runtimeState.activityLog.unshift(
        createActivity({
          kind: "docker",
          status: docker.running ? "stopping" : "stopped",
          badge: "DOCKER",
          title: docker.running ? "Docker stop requested" : "Docker is stopped",
          body: docker.running
            ? docker.detail || "Docker Desktop quit command was sent and is still settling."
            : docker.detail || "Docker Desktop is no longer reachable from the local daemon socket.",
        }),
      );
      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, await buildDashboardPayload(runtimeState));
    }

    if (url.pathname === "/api/docker/copy" && request.method === "POST") {
      const payload = await readJsonBody(request);
      const runtimeState = await loadRuntimeState();
      const result = await copyFileIntoDocker(payload);
      runtimeState.activityLog.unshift(
        createActivity({
          kind: "docker",
          status: "copied",
          badge: "COPY",
          title: `File sent to ${result.containerName || result.containerId}`,
          body: `${result.fileName} 已复制到 ${result.destination}。`,
        }),
      );
      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, await buildDashboardPayload(runtimeState));
    }

    if (url.pathname === "/api/docker/logs" && request.method === "POST") {
      const payload = await readJsonBody(request);
      const runtimeState = await loadRuntimeState();
      const result = await getDockerLogs(payload);
      runtimeState.activityLog.unshift(
        createActivity({
          kind: "docker",
          status: result.success ? "logs" : "logs-nonzero",
          badge: "LOGS",
          title: `${result.success ? "Logs fetched" : "Logs command returned non-zero"} from ${result.containerName || result.containerId}`,
          body: `最近 ${result.tail} 行日志已拉取到控制台面板，退出码 ${result.code}.`,
        }),
      );
      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, {
        dashboard: await buildDashboardPayload(runtimeState),
        result,
      });
    }

    if (url.pathname === "/api/docker/exec" && request.method === "POST") {
      const payload = await readJsonBody(request);
      const runtimeState = await loadRuntimeState();
      const result = await execInDocker(payload);
      runtimeState.activityLog.unshift(
        createActivity({
          kind: "docker",
          status: result.success ? "exec-ok" : "exec-nonzero",
          badge: "EXEC",
          title: `${result.success ? "Command finished" : "Command exited non-zero"} in ${result.containerName || result.containerId}`,
          body: `命令：${summarizeDockerCommand(result.command)}，退出码 ${result.code}.`,
        }),
      );
      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, {
        dashboard: await buildDashboardPayload(runtimeState),
        result,
      });
    }

    if (url.pathname === "/api/docker/download" && request.method === "POST") {
      const payload = await readJsonBody(request);
      const runtimeState = await loadRuntimeState();
      const result = await copyFileOutOfDocker(payload);
      runtimeState.activityLog.unshift(
        createActivity({
          kind: "docker",
          status: "downloaded",
          badge: "PULL",
          title: `File pulled from ${result.containerName || result.containerId}`,
          body: `${result.sourcePath} 已拉回本地浏览器下载流。`,
        }),
      );
      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, {
        dashboard: await buildDashboardPayload(runtimeState),
        result,
      });
    }

    if (url.pathname === "/api/runtime/m4-toggle" && request.method === "POST") {
      const payload = await readJsonBody(request);
      const runtimeState = await loadRuntimeState();
      runtimeState.m4DispatchEnabled =
        typeof payload.enabled === "boolean" ? payload.enabled : !runtimeState.m4DispatchEnabled;
      runtimeState.activityLog.unshift(
        createActivity({
          kind: "topology",
          status: runtimeState.m4DispatchEnabled ? "enabled" : "disabled",
          badge: "M4",
          title: runtimeState.m4DispatchEnabled ? "M4 burst routing enabled" : "M4 burst routing disabled",
          body: runtimeState.m4DispatchEnabled
            ? "M4 若在线且快照健康，将进入突发负载执行池。"
            : "M4 已从 burst 路由中摘除，即便在线也不会承接短时高负载任务。",
        }),
      );
      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, await buildDashboardPayload(runtimeState));
    }

    if (url.pathname === "/api/dispatch" && request.method === "POST") {
      const payload = await readJsonBody(request);
      const runtimeState = await loadRuntimeState();
      runtimeState.activityLog.unshift(
        createActivity({
          kind: "dispatch",
          status: "routed",
          badge: payload.agentName || "ROUTE",
          title: `${payload.agentName || "Request"} accepted by control plane`,
          body: `${payload.channelName || "Unknown channel"} -> ${payload.botName || "Unknown bot"} -> ${payload.executionNodeName || "Unknown execution node"}。摘要：${payload.brief || "未填写请求摘要。"}`,
        }),
      );
      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, await buildDashboardPayload(runtimeState));
    }

    if (url.pathname.startsWith("/api/alerts/") && request.method === "POST") {
      const payload = await readJsonBody(request);
      const runtimeState = await loadRuntimeState();
      const alertId = decodeURIComponent(url.pathname.split("/").pop() || "");
      const dashboard = await buildDashboardPayload(runtimeState);
      const alert = dashboard.alerts.find((entry) => entry.id === alertId);

      if (!alert) {
        return sendJson(response, 404, { error: "Alert not found" });
      }

      if (payload.mode === "auto-fix") {
        runtimeState.alertStates[alertId] = {
          status: "resolved",
          updatedAt: new Date().toISOString(),
          mode: "auto-fix",
        };
        runtimeState.activityLog.unshift(
          createActivity({
            kind: "doctor",
            status: "auto",
            badge: "AUTO",
            title: `${alert.actionLabel} attempted`,
            body: `${alert.title} 已触发低风险自动修复流程，结果已写回治理面活动流。`,
          }),
        );
      } else if (payload.mode === "approve") {
        if (!payload.owner || !payload.channelId) {
          return sendJson(response, 400, { error: "Missing approval owner or channel" });
        }
        if (alert.severity === "high" && payload.approvalText !== alert.approvalPhrase) {
          return sendJson(response, 400, { error: "Approval phrase mismatch" });
        }
        runtimeState.alertStates[alertId] = {
          status: "resolved",
          updatedAt: new Date().toISOString(),
          mode: "approved",
          owner: payload.owner,
          channelId: payload.channelId,
        };
        runtimeState.activityLog.unshift(
          createActivity({
            kind: "approval",
            status: "approved",
            badge: alert.severity === "high" ? "HUMAN" : "CHECK",
            title: `${alert.actionLabel} approved`,
            body: `${payload.owner} 在 ${payload.channelId} 审批通过后执行了「${alert.title}」。`,
          }),
        );
      } else {
        return sendJson(response, 400, { error: "Unsupported alert action" });
      }

      trimActivityLog(runtimeState);
      await saveRuntimeState(runtimeState);
      return sendJson(response, 200, await buildDashboardPayload(runtimeState));
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Method not allowed" });
    }

    return serveStaticFile(url.pathname, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Internal server error" });
  }
});

if (process.argv[1] && resolve(process.argv[1]) === modulePath && process.env.AI_MONITOR_NO_LISTEN !== "1") {
  server.listen(port, "127.0.0.1", () => {
    console.log(`AI Monitor Hub server listening on http://127.0.0.1:${port}`);
  });
}

export async function buildDashboardPayload(preloadedRuntimeState) {
  const runtimeState = preloadedRuntimeState || (await loadRuntimeState());
  const localSignals = await collectLocalSignals();
  const remoteSnapshotData = await loadRemoteSnapshots();
  const remoteSnapshots = remoteSnapshotData.snapshots;
  const nodes = buildNodeRuntime(localSignals, remoteSnapshots, runtimeState);
  const alerts = buildAlerts(localSignals, remoteSnapshots, runtimeState);
  const docker = await getDockerStatusSummary();

  return {
    generatedAt: new Date().toISOString(),
    sourceMode: "live",
    repo: localSignals.repo,
    m4DispatchEnabled: runtimeState.m4DispatchEnabled,
    docker,
    nodes,
    alerts,
    activities: runtimeState.activityLog,
    dataSources: {
      gateway: "live local macOS metrics",
      remoteNodes: remoteSnapshotData.sourceLabel,
    },
  };
}

async function collectLocalSignals() {
  const totalMemoryBytes = safeSystemValue(() => os.totalmem(), 0);
  const freeMemoryBytes = safeSystemValue(() => os.freemem(), 0);
  const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
  const cpuCount = safeSystemValue(() => os.cpus().length, 1) || 1;
  const [load1m, load5m, load15m] = safeSystemValue(() => os.loadavg(), [0, 0, 0]);
  const loadRatio = load1m / cpuCount;
  const disk = await getDiskUsage();
  const power = await getPowerSource();
  const repo = await getRepoSignals();

  return {
    hostname: safeSystemValue(() => os.hostname(), "localhost"),
    platform: `${safeSystemValue(() => os.platform(), "unknown")} ${safeSystemValue(() => os.release(), "")}`.trim(),
    uptimeSeconds: safeSystemValue(() => os.uptime(), 0),
    cpuCount,
    load1m,
    load5m,
    load15m,
    loadRatio,
    memoryUsedPercent: percent(usedMemoryBytes, totalMemoryBytes),
    memoryUsedBytes: usedMemoryBytes,
    totalMemoryBytes,
    disk,
    power,
    repo,
  };
}

function buildNodeRuntime(localSignals, remoteSnapshots, runtimeState) {
  const gatewayStatus =
    localSignals.disk.usedPercent >= 85 || localSignals.memoryUsedPercent >= 85
      ? "warning"
      : localSignals.loadRatio >= 0.8
        ? "watching"
        : "healthy";

  const nodes = [
    {
      id: "gateway-m2",
      status: gatewayStatus,
      metrics: [
        `Load ${formatPercent(localSignals.loadRatio)}`,
        `Mem ${localSignals.memoryUsedPercent}%`,
        `Disk ${localSignals.disk.usedPercent}%`,
      ],
      runtimeSummary: `${localSignals.hostname} · ${localSignals.platform} · ${localSignals.power}`,
      source: "local machine",
      lastSeen: "just now",
    },
  ];

  nodes.push(buildRemoteNode("studio", "Mac Studio", remoteSnapshots.studio, runtimeState));
  nodes.push(buildRemoteNode("m4", "MacBook Pro M4", remoteSnapshots.m4, runtimeState));
  nodes.push(buildRemoteNode("edge-fleet", "Edge Fleet", remoteSnapshots["edge-fleet"], runtimeState));

  return nodes;
}

function buildRemoteNode(id, label, snapshot, runtimeState) {
  const lastSeen = snapshot?.updatedAt ? describeAge(snapshot.updatedAt) : "no data yet";
  const stale = snapshot?.updatedAt ? Date.now() - Date.parse(snapshot.updatedAt) > refreshWindowMs : true;

  if (id === "m4") {
    const status = snapshot?.online
      ? runtimeState.m4DispatchEnabled
        ? stale
          ? "watching"
          : "healthy"
        : "standby"
      : "standby";

    return {
      id,
      status,
      metrics: snapshot
        ? [
            `Route ${runtimeState.m4DispatchEnabled ? "enabled" : "disabled"}`,
            snapshot.cpuPercent != null ? `CPU ${snapshot.cpuPercent}%` : `Seen ${lastSeen}`,
            snapshot.note || `Seen ${lastSeen}`,
          ]
        : [
            `Route ${runtimeState.m4DispatchEnabled ? "enabled" : "disabled"}`,
            "Waiting for remote snapshot",
            "Safe to stay offline",
          ],
      runtimeSummary: snapshot
        ? `online=${Boolean(snapshot.online)} · ${snapshot.note || "snapshot connected"}`
        : `${label} 还没有接入远端快照源。`,
      source: snapshot ? "remote snapshot" : "missing snapshot",
      lastSeen,
    };
  }

  if (!snapshot) {
    return {
      id,
      status: "watching",
      metrics: ["Waiting for remote snapshot", "No live node feed", "Configure snapshot file"],
      runtimeSummary: `${label} 尚未接入真实快照源。`,
      source: "missing snapshot",
      lastSeen,
    };
  }

  return {
    id,
    status: snapshot.online ? (stale ? "watching" : "healthy") : "warning",
    metrics: [
      snapshot.cpuPercent != null ? `CPU ${snapshot.cpuPercent}%` : `Seen ${lastSeen}`,
      snapshot.latencyMs != null ? `RTT ${snapshot.latencyMs}ms` : `Seen ${lastSeen}`,
      snapshot.note || `Seen ${lastSeen}`,
    ],
    runtimeSummary: `${label} 快照 ${snapshot.online ? "online" : "offline"} · updated ${lastSeen}`,
    source: "remote snapshot",
    lastSeen,
  };
}

function buildAlerts(localSignals, remoteSnapshots, runtimeState) {
  const alerts = [];

  if (localSignals.loadRatio >= 0.8) {
    alerts.push({
      id: "gateway-load-pressure",
      title: "M2 Gateway load ratio is elevated",
      domain: "Gateway",
      nodeId: "gateway-m2",
      severity: localSignals.loadRatio >= 1 ? "high" : "medium",
      actionLabel: "Review task routing and reduce pressure on M2",
      notes: `1m load 为 ${localSignals.load1m.toFixed(2)}，控制面负载正在升高。`,
    });
  }

  if (localSignals.disk.usedPercent >= 85) {
    alerts.push({
      id: "gateway-disk-headroom",
      title: "Gateway disk headroom is low",
      domain: "Node",
      nodeId: "gateway-m2",
      severity: "high",
      actionLabel: "Free disk space and audit large artifacts",
      approvalPhrase: "APPROVE HIGH RISK CHANGE",
      notes: `根分区已使用 ${localSignals.disk.usedPercent}% ，高风险清理动作需要人工审批。`,
    });
  }

  if (localSignals.repo.dirtyCount > 0) {
    alerts.push({
      id: "workspace-dirty",
      title: "Workspace has uncommitted changes",
      domain: "Repo",
      nodeId: "gateway-m2",
      severity: "low",
      actionLabel: "Refresh git status and review outstanding changes",
      notes: `当前分支 ${localSignals.repo.branch} 有 ${localSignals.repo.dirtyCount} 项未提交改动。`,
    });
  }

  for (const [nodeId, snapshot] of Object.entries(remoteSnapshots)) {
    if (!snapshot?.updatedAt) {
      continue;
    }
    const stale = Date.now() - Date.parse(snapshot.updatedAt) > refreshWindowMs;
    if (!stale) {
      continue;
    }
    alerts.push({
      id: `${nodeId}-snapshot-stale`,
      title: `${nodeId} snapshot is stale`,
      domain: "Node",
      nodeId,
      severity: "medium",
      actionLabel: "Refresh remote node snapshot",
      notes: `${nodeId} 上次上报已经超过 ${Math.round(refreshWindowMs / 60000)} 分钟。`,
    });
  }

  if (runtimeState.m4DispatchEnabled && !remoteSnapshots.m4?.online) {
    alerts.push({
      id: "m4-route-enabled-without-node",
      title: "M4 burst routing is enabled but node is offline",
      domain: "Elastic node",
      nodeId: "m4",
      severity: "medium",
      actionLabel: "Disable M4 burst routing or restore the node",
      notes: "当前策略允许把突发任务下发到 M4，但还没有收到在线快照。",
    });
  }

  return alerts.map((alert) => {
    const alertState = runtimeState.alertStates[alert.id];
    if (!alertState) {
      return { ...alert, status: "open" };
    }
    return {
      ...alert,
      status: alertState.status || "open",
      resolution: alertState,
    };
  });
}

async function loadRuntimeState() {
  const fallback = createDefaultRuntimeState();
  const raw = await readJsonFile(runtimeStatePath, fallback);
  return {
    m4DispatchEnabled:
      typeof raw.m4DispatchEnabled === "boolean" ? raw.m4DispatchEnabled : fallback.m4DispatchEnabled,
    alertStates: raw.alertStates && typeof raw.alertStates === "object" ? raw.alertStates : {},
    activityLog: Array.isArray(raw.activityLog) && raw.activityLog.length ? raw.activityLog : fallback.activityLog,
  };
}

async function saveRuntimeState(state) {
  await writeFile(runtimeStatePath, JSON.stringify(state, null, 2), "utf8");
}

async function loadRemoteSnapshots() {
  const legacySnapshots = await readJsonFile(remoteSnapshotPath, {});
  const directorySnapshots = {};

  try {
    const files = await readdir(nodeSnapshotDir);
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const snapshot = await readJsonFile(join(nodeSnapshotDir, file), null);
      if (!snapshot || typeof snapshot !== "object") {
        continue;
      }
      const nodeId = snapshot.nodeId || file.replace(/\.json$/u, "");
      if (!nodeId) {
        continue;
      }
      directorySnapshots[nodeId] = {
        ...snapshot,
        nodeId,
      };
    }
  } catch {
    // Ignore missing directory or unreadable files and keep fallback behavior.
  }

  const snapshots = {
    ...legacySnapshots,
    ...directorySnapshots,
  };

  const sourceParts = [];
  if (Object.keys(directorySnapshots).length > 0) {
    sourceParts.push(`data/node-snapshots (${Object.keys(directorySnapshots).length} node files)`);
  }
  if (existsSync(remoteSnapshotPath)) {
    sourceParts.push("data/remote-node-snapshots.json");
  }

  return {
    snapshots,
    sourceLabel: sourceParts.length ? sourceParts.join(" + ") : "no remote snapshot file detected yet",
  };
}

function createDefaultRuntimeState() {
  return {
    m4DispatchEnabled: false,
    alertStates: {},
    activityLog: [
      createActivity({
        kind: "system",
        status: "live",
        badge: "API",
        title: "Live data source connected",
        body: "Dashboard runtime is now served from the local API instead of browser-only mock state.",
      }),
    ],
  };
}

function createActivity({ kind, status, badge, title, body }) {
  const now = new Date();
  return {
    id: `${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
    kind,
    status,
    badge,
    title,
    body,
    createdAt: now.toISOString(),
    timestamp: new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(now),
  };
}

function trimActivityLog(state) {
  state.activityLog = state.activityLog.slice(0, 24);
}

async function getDiskUsage() {
  const { stdout } = await safeExec("df", ["-k", "/"]);
  const lines = stdout.trim().split("\n");
  const parts = lines.at(-1)?.trim().split(/\s+/) || [];
  const capacityText = parts[4] || "0%";
  const usedPercent = Number.parseInt(capacityText.replace("%", ""), 10) || 0;
  const sizeKb = Number(parts[1] || 0);
  const availKb = Number(parts[3] || 0);

  return {
    usedPercent,
    sizeGb: Math.round(sizeKb / 1024 / 1024),
    availGb: Math.round(availKb / 1024 / 1024),
  };
}

async function getPowerSource() {
  const { stdout } = await safeExec("pmset", ["-g", "batt"]);
  const firstLine = stdout.trim().split("\n")[0] || "";
  return firstLine.replace("Now drawing from ", "").replaceAll("'", "") || "unknown power";
}

async function getRepoSignals() {
  const branchResult = await safeExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: rootDir });
  const statusResult = await safeExec("git", ["status", "--short"], { cwd: rootDir });
  const dirtyLines = statusResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    branch: branchResult.stdout.trim() || "unknown",
    dirtyCount: dirtyLines.length,
  };
}

async function getDockerStatusSummary() {
  const appInstalled = existsSync("/Applications/Docker.app");
  const versionResult = await safeExecDetailed("docker", ["version", "--format", "{{json .}}"], {
    timeout: 4000,
  });
  const versionInfo = parseEmbeddedJson(versionResult.output);
  const clientVersion = versionInfo?.Client?.Version || null;
  const serverVersion = versionInfo?.Server?.Version || null;
  const contextName = versionInfo?.Client?.Context || null;
  const daemonReachable = Boolean(serverVersion);
  const permissionDenied = /permission denied/i.test(versionResult.output);
  const clientAvailable = Boolean(clientVersion) || !/not found|ENOENT/i.test(versionResult.output);

  let containers = [];
  if (daemonReachable) {
    const psResult = await safeExecDetailed(
      "docker",
      ["ps", "-a", "--format", "{{json .}}"],
      { timeout: 4000 },
    );
    containers = parseJsonLines(psResult.stdout).map((entry) => ({
      id: entry.ID || "",
      name: entry.Names || entry.Name || "",
      image: entry.Image || "",
      status: entry.Status || "",
      state: normalizeDockerState(entry.State || entry.Status || ""),
      runningFor: entry.RunningFor || "",
    }));
  }

  return {
    installed: appInstalled || clientAvailable,
    appInstalled,
    clientAvailable,
    running: daemonReachable,
    status: dockerStatusLabel({ appInstalled, clientAvailable, daemonReachable, permissionDenied }),
    detail: dockerDetailMessage({
      appInstalled,
      clientAvailable,
      daemonReachable,
      permissionDenied,
      output: versionResult.output,
    }),
    clientVersion,
    serverVersion,
    contextName,
    containers,
    runningCount: containers.filter((entry) => entry.state === "running").length,
  };
}

async function startDockerDesktop() {
  if (!existsSync("/Applications/Docker.app")) {
    return {
      installed: false,
      running: false,
      status: "not-installed",
      detail: "Docker.app is not installed in /Applications.",
      containers: [],
      runningCount: 0,
      clientAvailable: false,
      appInstalled: false,
      clientVersion: null,
      serverVersion: null,
      contextName: null,
    };
  }

  await safeExecDetailed("open", ["-a", "Docker"], { timeout: 4000 });
  const docker = await waitForDockerState((status) => status.running, {
    attempts: 8,
    intervalMs: 1500,
  });

  if (docker.running) {
    return docker;
  }

  return {
    ...docker,
    detail: "Docker Desktop start command was sent. The daemon is still warming up.",
  };
}

async function stopDockerDesktop() {
  if (!existsSync("/Applications/Docker.app")) {
    return {
      installed: false,
      running: false,
      status: "not-installed",
      detail: "Docker.app is not installed in /Applications.",
      containers: [],
      runningCount: 0,
      clientAvailable: false,
      appInstalled: false,
      clientVersion: null,
      serverVersion: null,
      contextName: null,
    };
  }

  await safeExecDetailed("osascript", ["-e", 'quit app "Docker"'], { timeout: 5000 });
  const docker = await waitForDockerState((status) => !status.running, {
    attempts: 6,
    intervalMs: 1200,
  });

  if (!docker.running) {
    return docker;
  }

  return {
    ...docker,
    detail: "Docker quit command was sent, but the daemon still appears to be shutting down.",
  };
}

async function copyFileIntoDocker(payload) {
  const { container, containerId } = await getDockerContainerScope(payload);
  const destinationPath = String(payload.destinationPath || "").trim();
  const fileName = basename(String(payload.fileName || "").trim() || "upload.bin");
  const fileContentBase64 = String(payload.fileContentBase64 || "");

  if (!destinationPath) {
    throw new Error("Destination path is required.");
  }
  if (!fileContentBase64) {
    throw new Error("Upload payload is empty.");
  }

  const buffer = Buffer.from(fileContentBase64, "base64");
  if (!buffer.length) {
    throw new Error("Upload payload could not be decoded.");
  }
  if (buffer.length > 25 * 1024 * 1024) {
    throw new Error("File is too large. Please keep Docker uploads below 25 MB in this UI.");
  }

  const tempDir = await mkdtemp(join(os.tmpdir(), "ai-monitor-docker-"));
  const tempFilePath = join(tempDir, fileName);
  const dockerDestination =
    destinationPath.endsWith("/") ? `${destinationPath}${fileName}` : destinationPath;

  try {
    await writeFile(tempFilePath, buffer);
    const copyResult = await safeExecDetailed("docker", [
      "cp",
      tempFilePath,
      `${containerId}:${dockerDestination}`,
    ], {
      timeout: 15000,
    });

    if (!copyResult.success) {
      throw new Error(copyResult.output || "docker cp failed.");
    }

    return {
      containerId,
      containerName: container.name,
      destination: dockerDestination,
      fileName,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function getDockerLogs(payload) {
  const { container, containerId } = await getDockerContainerScope(payload);
  const tail = sanitizeDockerTail(payload.tail);
  const logsResult = await safeExecDetailed(
    "docker",
    ["logs", "--tail", String(tail), containerId],
    {
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const output = [logsResult.stdout, logsResult.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!logsResult.success && !output) {
    throw new Error(logsResult.output || "docker logs failed.");
  }

  return {
    containerId,
    containerName: container.name,
    tail,
    success: logsResult.success,
    code: logsResult.code ?? (logsResult.success ? 0 : 1),
    fetchedAt: new Date().toISOString(),
    output: output || "No logs returned for this container.",
  };
}

async function execInDocker(payload) {
  const { container, containerId } = await getDockerContainerScope(payload, {
    requireRunningContainer: true,
  });
  const command = String(payload.command || "").trim();

  if (!command) {
    throw new Error("Command is required.");
  }
  if (command.length > 4000) {
    throw new Error("Command is too long. Please keep it below 4000 characters.");
  }

  const shellCandidates = [
    ["/bin/sh", "-lc"],
    ["sh", "-lc"],
    ["/bin/bash", "-lc"],
    ["bash", "-lc"],
  ];
  let shellUsed = shellCandidates[0][0];
  let execResult = null;

  for (const shellArgs of shellCandidates) {
    shellUsed = shellArgs[0];
    execResult = await safeExecDetailed(
      "docker",
      ["exec", containerId, ...shellArgs, command],
      {
        timeout: 20000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (execResult.success || !isMissingDockerShell(execResult.output)) {
      break;
    }
  }

  const output = [execResult.stdout, execResult.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    containerId,
    containerName: container.name,
    command,
    shell: shellUsed,
    success: execResult.success,
    code: execResult.code ?? (execResult.success ? 0 : 1),
    executedAt: new Date().toISOString(),
    output: output || (execResult.success ? "Command completed without output." : execResult.output || "Command exited without output."),
  };
}

async function copyFileOutOfDocker(payload) {
  const { container, containerId } = await getDockerContainerScope(payload);
  const sourcePath = String(payload.sourcePath || "").trim();

  if (!sourcePath) {
    throw new Error("Source path is required.");
  }
  if (sourcePath.endsWith("/")) {
    throw new Error("Please provide a file path, not a directory path.");
  }

  const tempDir = await mkdtemp(join(os.tmpdir(), "ai-monitor-docker-pull-"));
  const targetName = basename(sourcePath) || "download.bin";
  const tempFilePath = join(tempDir, targetName);

  try {
    const copyResult = await safeExecDetailed(
      "docker",
      ["cp", `${containerId}:${sourcePath}`, tempFilePath],
      {
        timeout: 15000,
      },
    );

    if (!copyResult.success) {
      throw new Error(copyResult.output || "docker cp failed.");
    }

    const fileStat = await stat(tempFilePath);
    if (fileStat.isDirectory()) {
      throw new Error("Directory downloads are not supported in this UI yet.");
    }

    if (fileStat.size > 12 * 1024 * 1024) {
      throw new Error("File is too large. Please keep Docker downloads below 12 MB in this UI.");
    }

    const buffer = await readFile(tempFilePath);

    return {
      containerId,
      containerName: container.name,
      sourcePath,
      fileName: targetName,
      sizeBytes: buffer.length,
      mimeType: contentType(targetName).replace(/; charset=utf-8$/i, ""),
      fileContentBase64: buffer.toString("base64"),
      downloadedAt: new Date().toISOString(),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function serveStaticFile(pathname, response) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(staticRoot, safePath);

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      return serveStaticFile(join(normalizedPath, "index.html"), response);
    }
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-cache",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const fallbackIndex = join(staticRoot, "index.html");
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    createReadStream(fallbackIndex).pipe(response);
  }
}

function contentType(filePath) {
  const extension = extname(filePath);
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js" || extension === ".mjs") {
    return "application/javascript; charset=utf-8";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readJsonFile(filePath, fallback) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function ensureDataDirectory() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(nodeSnapshotDir, { recursive: true });
  try {
    await access(runtimeStatePath);
  } catch {
    await saveRuntimeState(createDefaultRuntimeState());
  }
}

async function safeExec(command, args, options = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 2500,
      maxBuffer: 1024 * 1024,
    });
    return { stdout };
  } catch {
    return { stdout: "" };
  }
}

async function safeExecDetailed(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 4000,
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    });
    return {
      success: true,
      code: 0,
      stdout,
      stderr,
      output: [stdout, stderr].filter(Boolean).join("\n").trim(),
    };
  } catch (error) {
    return {
      success: false,
      code: error.code ?? 1,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      output: [error.stdout || "", error.stderr || "", error.message || ""]
        .filter(Boolean)
        .join("\n")
        .trim(),
    };
  }
}

function percent(part, whole) {
  if (!whole) {
    return 0;
  }
  return Math.round((part / whole) * 100);
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function describeAge(isoTime) {
  const deltaMs = Date.now() - Date.parse(isoTime);
  if (Number.isNaN(deltaMs)) {
    return "unknown";
  }
  const deltaMinutes = Math.round(deltaMs / 60000);
  if (deltaMinutes <= 1) {
    return "just now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function safeSystemValue(reader, fallback) {
  try {
    return reader();
  } catch {
    return fallback;
  }
}

function parseEmbeddedJson(text) {
  const line = String(text || "")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("{") && entry.endsWith("}"));

  if (!line) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseJsonLines(text) {
  return String(text || "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return JSON.parse(entry);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function getDockerContainerScope(payload, options = {}) {
  const docker = await getDockerStatusSummary();
  if (!docker.running) {
    throw new Error("Docker daemon is not running.");
  }

  const containerId = String(payload.containerId || "").trim();
  if (!containerId) {
    throw new Error("Container is required.");
  }

  const container = docker.containers.find(
    (entry) => entry.id === containerId || entry.name === containerId,
  );
  if (!container) {
    throw new Error("Container was not found in the local Docker daemon.");
  }

  if (options.requireRunningContainer && container.state !== "running") {
    throw new Error("This action requires a running container.");
  }

  return {
    docker,
    containerId,
    container,
  };
}

function dockerStatusLabel({ appInstalled, clientAvailable, daemonReachable, permissionDenied }) {
  if (!appInstalled && !clientAvailable) {
    return "not-installed";
  }
  if (daemonReachable) {
    return "running";
  }
  if (permissionDenied) {
    return "permission-denied";
  }
  return "stopped";
}

function dockerDetailMessage({ appInstalled, clientAvailable, daemonReachable, permissionDenied, output }) {
  if (!appInstalled && !clientAvailable) {
    return "Docker CLI and Docker Desktop are not available on this machine.";
  }
  if (daemonReachable) {
    return "Docker daemon is reachable and ready for container operations.";
  }
  if (permissionDenied) {
    return "Docker CLI exists, but the daemon socket denied access. Check local permissions or desktop session context.";
  }
  if (/Cannot connect|error during connect|daemon/i.test(output || "")) {
    return "Docker Desktop is installed, but the daemon is not running yet.";
  }
  return "Docker status could not be confirmed yet.";
}

function normalizeDockerState(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("up") || text.includes("running")) {
    return "running";
  }
  if (text.includes("restart")) {
    return "restarting";
  }
  if (text.includes("pause")) {
    return "paused";
  }
  if (text.includes("exited") || text.includes("stopped")) {
    return "stopped";
  }
  if (text.includes("created")) {
    return "created";
  }
  return text || "unknown";
}

function sanitizeDockerTail(value) {
  const parsed = Number.parseInt(String(value || "200"), 10);
  if (!Number.isFinite(parsed)) {
    return 200;
  }
  return Math.min(500, Math.max(20, parsed));
}

function isMissingDockerShell(output) {
  return /executable file not found|no such file or directory|stat .* no such file/i.test(output || "");
}

function summarizeDockerCommand(command) {
  const text = String(command || "").replace(/\s+/g, " ").trim();
  if (text.length <= 90) {
    return text;
  }
  return `${text.slice(0, 87)}...`;
}

async function waitForDockerState(predicate, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 1));
  const intervalMs = Math.max(0, Number(options.intervalMs || 0));
  let lastStatus = await getDockerStatusSummary();

  if (predicate(lastStatus)) {
    return lastStatus;
  }

  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (intervalMs) {
      await delay(intervalMs);
    }
    lastStatus = await getDockerStatusSummary();
    if (predicate(lastStatus)) {
      return lastStatus;
    }
  }

  return lastStatus;
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
