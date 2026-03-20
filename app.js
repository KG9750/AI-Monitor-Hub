const STORAGE_KEY = "ai-monitor-hub-state-v1";

const NODE_BLUEPRINTS = [
  {
    id: "gateway-m2",
    group: "control",
    name: "MacBook Pro M2",
    location: "Home",
    status: "healthy",
    role: "唯一常驻 Gateway",
    summary:
      "持有 Channels、Bindings、Sessions、Auth、Control UI，以及 Doctor 治理平面。",
    carry: [
      "Gateway 会话真相源",
      "PM / Research / Doctor 常驻决策",
      "Bot 入口与权限边界",
    ],
    avoid: [
      "重型模型推理",
      "长期高负载编译",
      "大内存索引任务",
    ],
    metrics: ["Uptime 31d", "CPU 24%", "Session lag 12ms"],
  },
  {
    id: "studio",
    group: "execution",
    name: "Mac Studio",
    location: "Home",
    status: "healthy",
    role: "重型执行与模型服务",
    summary:
      "承接本地模型、索引检索、文件处理、Node Host 与重型脚本，不承担主控职责。",
    carry: ["Qwen / MiniMax 服务", "Indexer 与重型脚本", "Coder / Ops 下沉执行"],
    avoid: ["会话真相源", "唯一 Bot 连接", "关键权限配置主副本"],
    metrics: ["GPU queue 62%", "Indexer warm", "Model RTT 148ms"],
  },
  {
    id: "m4",
    group: "elastic",
    name: "MacBook Pro M4",
    location: "Office",
    status: "standby",
    role: "弹性增强节点",
    summary:
      "在线时承接短时高负载编译、测试和图像处理；离线不影响整体系统可用性。",
    carry: ["Burst build", "临时高负载编码", "图像与多媒体处理"],
    avoid: ["主 Gateway", "唯一配置", "唯一会话存储"],
    metrics: ["On-demand only", "No core state", "Joined via Node Host"],
  },
  {
    id: "edge-fleet",
    group: "edge",
    name: "Edge Fleet",
    location: "Lab",
    status: "watching",
    role: "边缘辅助节点",
    summary: "负责监控、备份、归档、Webhook 中继与日志沉淀，但不进入核心编排链路。",
    carry: ["监控与归档", "Webhook 中继", "日志存放"],
    avoid: ["业务主控", "核心 Agent", "会话与权限主链路"],
    metrics: ["Archive sync", "Webhook standby", "Cold backup ready"],
  },
];

const BOTS = [
  {
    id: "northstar-pm",
    name: "Northstar PM",
    surface: "Discord DM",
    defaultAgent: "pm",
    description: "负责需求理解、计划拆解与跨 Agent 委派。",
  },
  {
    id: "scout-research",
    name: "Scout Research",
    surface: "Guild / DM",
    defaultAgent: "research",
    description: "负责检索、阅读、总结与比较，默认只读。",
  },
  {
    id: "forge-coder",
    name: "Forge Coder",
    surface: "Private build room",
    defaultAgent: "coder",
    description: "负责编码、脚本和产物落盘，执行能力优先下沉。",
  },
  {
    id: "doctor-beacon",
    name: "Doctor Beacon",
    surface: "#system-alerts",
    defaultAgent: "doctor",
    description: "只处理健康巡检、告警与受限自动修复。",
  },
];

const CHANNELS = [
  {
    id: "discord-dm",
    name: "Discord DM",
    scope: "private",
    allows: ["pm", "research", "coder", "ops", "doctor"],
    note: "私人入口，允许完整编排与审批。",
  },
  {
    id: "guild-collab",
    name: "Guild collaborative room",
    scope: "public",
    allows: ["pm", "research", "coder"],
    note: "公共协作频道，只适合低权限 Agent。",
  },
  {
    id: "private-ops",
    name: "Private ops room",
    scope: "private",
    allows: ["ops", "doctor", "pm", "coder"],
    note: "运维与恢复通道，仅限 allowlist。",
  },
  {
    id: "system-alerts",
    name: "#system-alerts",
    scope: "private",
    allows: ["doctor", "ops"],
    note: "Doctor 告警、审批与复盘回执。",
  },
];

const AGENTS = {
  pm: {
    id: "pm",
    name: "PM",
    homeNodeId: "gateway-m2",
    privateOnly: false,
    summary: "需求拆解、计划、委派、结果汇总。",
  },
  research: {
    id: "research",
    name: "Research",
    homeNodeId: "gateway-m2",
    privateOnly: false,
    summary: "阅读、检索、总结与比较，默认只读。",
  },
  coder: {
    id: "coder",
    name: "Coder",
    homeNodeId: "studio",
    privateOnly: false,
    summary: "代码生成、脚本编写与产物落盘，执行优先下沉。",
  },
  ops: {
    id: "ops",
    name: "Ops",
    homeNodeId: "studio",
    privateOnly: true,
    summary: "部署、恢复与诊断，只在私有入口触发。",
  },
  doctor: {
    id: "doctor",
    name: "Doctor",
    homeNodeId: "gateway-m2",
    privateOnly: true,
    summary: "健康观察、告警、根因判断与有限自动修复。",
  },
};

const REQUEST_TYPES = [
  {
    id: "plan",
    label: "需求拆解",
    agentId: "pm",
    summary: "由 PM 在 M2 上编排，并在需要时委派其他 Agent。",
  },
  {
    id: "research",
    label: "检索总结",
    agentId: "research",
    summary: "Research 保持只读，常驻 M2，不进入重型执行层。",
  },
  {
    id: "code",
    label: "代码与脚本",
    agentId: "coder",
    summary: "Coder 在执行面工作，优先下沉到 Studio 或在线的 M4。",
  },
  {
    id: "ops",
    label: "部署与恢复",
    agentId: "ops",
    summary: "Ops 只在私有入口和 allowlist 中开放。",
  },
  {
    id: "incident",
    label: "健康异常",
    agentId: "doctor",
    summary: "Doctor 负责异常分级、修复决策和告警闭环。",
  },
];

const LOADS = [
  {
    id: "interactive",
    label: "交互型",
    summary: "低延迟路径，优先 M2 编排 + Studio 常规执行。",
  },
  {
    id: "heavy",
    label: "重任务",
    summary: "长时脚本、模型或索引任务，应优先交给 Mac Studio。",
  },
  {
    id: "burst",
    label: "突发峰值",
    summary: "若 M4 在线，可承接短时高峰而不影响主控连续性。",
  },
];

const PHASES = [
  {
    id: "phase-1",
    name: "Phase 1",
    title: "先跑通主链路",
    summary: "M2 Gateway、Discord 主入口、PM/Research/Coder、Mac Studio 执行通道。",
    done: "你能稳定在 Discord 下发任务并收到结果。",
  },
  {
    id: "phase-2",
    name: "Phase 2",
    title: "增强可运维性",
    summary: "Doctor 探针、私有告警频道、基础自动修复、异常留痕。",
    done: "系统异常可以自动告警，低风险问题能自动恢复。",
  },
  {
    id: "phase-3",
    name: "Phase 3",
    title: "引入弹性节点",
    summary: "M4 Node、负载策略、备用模型切换。",
    done: "M4 在线时自动承接短时重任务，离线不影响主控。",
  },
  {
    id: "phase-4",
    name: "Phase 4",
    title: "收敛治理与优化",
    summary: "权限细化、目录规范、例行巡检、故障复盘模板。",
    done: "系统进入长期稳定运行状态。",
  },
];

const REVISION_CARDS = [
  {
    title: "M2 固定为唯一控制面",
    body: "所有 Bot 入口、Bindings、Sessions、Auth 与 Control UI 都收敛在 M2，不再允许 Mac Studio 变成隐性主控。",
  },
  {
    title: "Doctor 独立于业务编排",
    body: "Doctor 只观察、诊断、告警与有限修复，不与 PM / Research / Coder 共用普通业务路径。",
  },
  {
    title: "Mac Studio 回归执行层",
    body: "Studio 承担本地模型、索引检索、文件处理与重型脚本，但不持有会话真相源和关键权限副本。",
  },
  {
    title: "M4 只做在线即加入的弹性节点",
    body: "M4 在线时增强算力，离线时整体系统仍可运行，也不保存唯一配置和会话。",
  },
];

const APPROVAL_POLICIES = [
  {
    risk: "low",
    title: "低风险",
    rules: "重试探针、重连节点、切换备用模型、重启只读监控进程可自动完成。",
    action: "系统直接执行并留痕。",
  },
  {
    risk: "medium",
    title: "中风险",
    rules: "安全重启服务、恢复 bot worker、重新挂接节点需要限频并推送告警。",
    action: "需要私有入口和人工确认负责人后执行。",
  },
  {
    risk: "high",
    title: "高风险",
    rules: "修改配置、刷新凭据、批量删会话、改 bindings / auth、任意 shell 都必须审批。",
    action: "必须在私有通道中输入确认短语后才可批准。",
  },
];

function createInitialAlerts() {
  return [
    {
      id: "alert-model-fallback",
      title: "Mac Studio 模型延迟升高",
      domain: "Node",
      nodeId: "studio",
      severity: "low",
      status: "open",
      actionLabel: "切换备用模型并重试探针",
      notes: "低风险动作，可由 Doctor 自动完成并回写告警频道。",
    },
    {
      id: "alert-gateway-backlog",
      title: "M2 Gateway 会话写入出现积压",
      domain: "Gateway",
      nodeId: "gateway-m2",
      severity: "medium",
      status: "open",
      actionLabel: "安全重启 gateway worker",
      notes: "需要限频执行，并确认当前路径来自私有入口。",
    },
    {
      id: "alert-m4-rejoin",
      title: "M4 节点离线后等待重新挂接",
      domain: "Elastic node",
      nodeId: "m4",
      severity: "medium",
      status: "open",
      actionLabel: "重新挂接 M4 Node Host",
      notes: "只有当 M4 应当在线时才执行；离线待命本身并不算事故。",
    },
    {
      id: "alert-token-rotation",
      title: "Bot token 与 bindings 接近轮换窗口",
      domain: "Channel",
      nodeId: "gateway-m2",
      severity: "high",
      status: "open",
      actionLabel: "刷新 token 并校验 bindings",
      approvalPhrase: "APPROVE HIGH RISK CHANGE",
      notes: "高风险动作，会影响 Auth 与入口映射，必须人工批准。",
    },
  ];
}

function createInitialActivities() {
  return [
    createActivity({
      kind: "architecture",
      status: "aligned",
      badge: "SYNC",
      title: "控制面已对齐到 M2 Gateway",
      body: "根据附件架构方案，M2 被固定为唯一常驻 Gateway 与会话真相源。",
    }),
    createActivity({
      kind: "architecture",
      status: "aligned",
      badge: "DOCTOR",
      title: "Doctor 被隔离为独立治理平面",
      body: "Doctor 不再加入普通业务编排，只保留观察、分级告警与有限修复。",
    }),
    createActivity({
      kind: "topology",
      status: "watching",
      badge: "M4",
      title: "M4 设置为弹性节点模式",
      body: "节点在线即加入，离线不影响主控，也不承载唯一配置与会话状态。",
    }),
  ];
}

function createDefaultState() {
  return {
    selectedNodeId: "gateway-m2",
    nodeFilter: "all",
    form: {
      botId: "northstar-pm",
      channelId: "discord-dm",
      requestTypeId: "plan",
      loadId: "interactive",
      brief: "请检查当前 Gateway 架构是否符合 M2 单中心控制面的原则。",
    },
    dockerForm: {
      containerId: "",
      destinationPath: "/tmp/",
    },
    modal: null,
  };
}

function createFallbackRuntime() {
  return {
    generatedAt: null,
    sourceMode: "fallback",
    dataSources: {
      gateway: "browser fallback",
      remoteNodes: "browser fallback",
    },
    repo: {
      branch: "unknown",
      dirtyCount: 0,
    },
    docker: {
      installed: false,
      appInstalled: false,
      clientAvailable: false,
      running: false,
      status: "unknown",
      detail: "Docker status has not been loaded yet.",
      clientVersion: null,
      serverVersion: null,
      contextName: null,
      containers: [],
      runningCount: 0,
    },
    m4DispatchEnabled: false,
    nodes: [],
    alerts: createInitialAlerts(),
    activities: createInitialActivities(),
  };
}

let state = loadState();
let runtime = createFallbackRuntime();

const refs = {
  hero: document.querySelector("#heroContent"),
  nodeFilters: document.querySelector("#nodeFilters"),
  nodeGrid: document.querySelector("#nodeGrid"),
  nodeDetail: document.querySelector("#nodeDetail"),
  botSurface: document.querySelector("#botSurface"),
  routingForm: document.querySelector("#routingForm"),
  botSelect: document.querySelector("#botSelect"),
  channelSelect: document.querySelector("#channelSelect"),
  requestSelect: document.querySelector("#requestSelect"),
  loadSelect: document.querySelector("#loadSelect"),
  requestBrief: document.querySelector("#requestBrief"),
  routingPreview: document.querySelector("#routingPreview"),
  doctorSummary: document.querySelector("#doctorSummary"),
  doctorAlerts: document.querySelector("#doctorAlerts"),
  revisionLedger: document.querySelector("#revisionLedger"),
  phaseTimeline: document.querySelector("#phaseTimeline"),
  policyTable: document.querySelector("#policyTable"),
  activityFeed: document.querySelector("#activityFeed"),
  modalHost: document.querySelector("#modalHost"),
  toastHost: document.querySelector("#toastHost"),
  resetStateButton: document.querySelector("#resetStateButton"),
  dockerMenuButton: document.querySelector("#dockerMenuButton"),
  dockerMenuSummary: document.querySelector("#dockerMenuSummary"),
};

void bootstrap();

async function bootstrap() {
  populateSelect(refs.botSelect, BOTS, "id", "name");
  populateSelect(refs.channelSelect, CHANNELS, "id", "name");
  populateSelect(refs.requestSelect, REQUEST_TYPES, "id", "label");
  populateSelect(refs.loadSelect, LOADS, "id", "label");
  bindEvents();
  render();
  await refreshDashboard();
  window.setInterval(() => {
    void refreshDashboard({ silent: true });
  }, 15000);
}

function bindEvents() {
  refs.routingForm.addEventListener("input", handleFormInput);
  refs.routingForm.addEventListener("submit", handleDispatch);
  refs.nodeFilters.addEventListener("click", handleFilterClick);
  refs.nodeGrid.addEventListener("click", handleNodeGridClick);
  refs.doctorAlerts.addEventListener("click", handleDoctorActions);
  refs.botSurface.addEventListener("click", handleBotCardClick);
  refs.modalHost.addEventListener("click", handleModalClick);
  refs.modalHost.addEventListener("input", handleModalInput);
  refs.modalHost.addEventListener("change", handleModalInput);
  refs.modalHost.addEventListener("submit", handleModalSubmit);
  refs.resetStateButton.addEventListener("click", handleResetState);
  refs.dockerMenuButton.addEventListener("click", handleOpenDockerModal);
}

async function handleResetState() {
  await refreshDashboard();
  toast("已重新拉取实时数据。", "success");
}

async function handleOpenDockerModal() {
  await refreshDashboard({ silent: true });
  state.modal = {
    type: "docker",
  };
  saveState();
  renderModal();
}

function handleFormInput(event) {
  const { name, value } = event.target;
  if (!(name in state.form)) {
    return;
  }
  state.form[name] = value;

  if (name === "requestTypeId") {
    const request = getRequestType(value);
    if (request) {
      const matchedBot = BOTS.find((bot) => bot.defaultAgent === request.agentId);
      if (matchedBot) {
        state.form.botId = matchedBot.id;
      }
    }
  }

  saveState();
  renderRoutingPreview();
  renderBotSurface();
}

async function handleDispatch(event) {
  event.preventDefault();
  const plan = computeRoutingPlan();

  if (plan.blocked) {
    toast("当前路径不符合权限策略，已阻止分发。", "warning");
    return;
  }

  try {
    const payload = await apiRequest("/api/dispatch", {
      method: "POST",
      body: {
        botName: plan.bot.name,
        channelName: plan.channel.name,
        agentName: plan.agent.name,
        executionNodeName: plan.executionNode.name,
        brief: state.form.brief.trim(),
      },
    });
    runtime = payload;
    state.selectedNodeId = plan.executionNode.id;
    saveState();
    render();
    toast("请求已进入实时调度流。", "success");
  } catch (error) {
    toast(error.message || "分发失败，未能写入实时数据源。", "warning");
  }
}

function handleFilterClick(event) {
  const button = event.target.closest("[data-filter]");
  if (!button) {
    return;
  }
  state.nodeFilter = button.dataset.filter;
  saveState();
  renderNodeFilters();
  renderNodeGrid();
}

async function handleNodeGridClick(event) {
  const toggle = event.target.closest("[data-toggle-node]");
  if (toggle) {
    const nodeId = toggle.dataset.toggleNode;
    if (nodeId === "m4") {
      try {
        const payload = await apiRequest("/api/runtime/m4-toggle", {
          method: "POST",
          body: {
            enabled: !runtime.m4DispatchEnabled,
          },
        });
        runtime = payload;
        state.selectedNodeId = "m4";
        saveState();
        render();
        toast(runtime.m4DispatchEnabled ? "M4 burst 路由已启用。" : "M4 burst 路由已关闭。", "success");
      } catch (error) {
        toast(error.message || "未能更新 M4 路由状态。", "warning");
      }
    }
    return;
  }

  const card = event.target.closest("[data-node-id]");
  if (!card) {
    return;
  }
  state.selectedNodeId = card.dataset.nodeId;
  saveState();
  renderNodeGrid();
  renderNodeDetail();
}

function handleBotCardClick(event) {
  const button = event.target.closest("[data-bot-id]");
  if (!button) {
    return;
  }
  const bot = getBot(button.dataset.botId);
  state.form.botId = bot.id;
  const linkedRequest = REQUEST_TYPES.find((request) => request.agentId === bot.defaultAgent);
  if (linkedRequest) {
    state.form.requestTypeId = linkedRequest.id;
  }
  syncFormControls();
  saveState();
  renderBotSurface();
  renderRoutingPreview();
}

async function handleDoctorActions(event) {
  const button = event.target.closest("[data-alert-action]");
  if (!button) {
    return;
  }

  const alertId = button.dataset.alertId;
  const action = button.dataset.alertAction;
  const currentAlert = getAlert(alertId);
  if (!currentAlert) {
    return;
  }

  state.selectedNodeId = currentAlert.nodeId;
  renderNodeGrid();
  renderNodeDetail();

  if (action === "resolve-low") {
    try {
      runtime = await apiRequest(`/api/alerts/${encodeURIComponent(alertId)}`, {
        method: "POST",
        body: {
          mode: "auto-fix",
        },
      });
      render();
      toast("低风险修复已写入实时数据源。", "success");
    } catch (error) {
      toast(error.message || "自动修复失败。", "warning");
    }
    return;
  }

  if (action === "review") {
    state.modal = {
      type: "approval",
      alertId,
    };
    saveState();
    renderNodeGrid();
    renderNodeDetail();
    renderModal();
    return;
  }
}

async function handleModalClick(event) {
  const dockerActionButton = event.target.closest("[data-docker-action]");
  if (dockerActionButton) {
    await handleDockerAction(dockerActionButton.dataset.dockerAction);
    return;
  }

  const containerCard = event.target.closest("[data-select-container]");
  if (containerCard) {
    state.dockerForm.containerId = containerCard.dataset.selectContainer || "";
    saveState();
    renderModal();
    return;
  }

  if (event.target.matches("[data-close-modal]") || event.target === refs.modalHost.firstElementChild) {
    state.modal = null;
    saveState();
    renderModal();
  }
}

function handleModalInput(event) {
  if (state.modal?.type !== "docker") {
    return;
  }

  if (event.target.name === "containerId") {
    state.dockerForm.containerId = String(event.target.value || "").trim();
    saveState();
    return;
  }

  if (event.target.name === "destinationPath") {
    state.dockerForm.destinationPath = String(event.target.value || "");
    saveState();
  }
}

async function handleModalSubmit(event) {
  if (event.target.id === "dockerCopyForm") {
    event.preventDefault();
    await handleDockerCopySubmit(event.target);
    return;
  }

  if (event.target.id !== "approvalForm") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(event.target);
  const alertId = formData.get("alertId");
  const owner = (formData.get("owner") || "").trim();
  const channelId = formData.get("channelId");
  const acknowledge = formData.get("privateAck");
  const approvalText = (formData.get("approvalText") || "").trim();
  const alert = getAlert(alertId);
  const channel = getChannel(channelId);

  if (!alert || !channel) {
    toast("审批目标不存在，已取消。", "warning");
    state.modal = null;
    renderModal();
    return;
  }

  if (!owner) {
    toast("请填写负责人。", "warning");
    return;
  }

  if (channel.scope !== "private") {
    toast("审批动作必须经由私有入口。", "warning");
    return;
  }

  if (!acknowledge) {
    toast("请确认当前动作来自私有审批路径。", "warning");
    return;
  }

  if (alert.severity === "high" && approvalText !== alert.approvalPhrase) {
    toast("确认短语不匹配，高风险动作未被批准。", "warning");
    return;
  }

  try {
    runtime = await apiRequest(`/api/alerts/${encodeURIComponent(alert.id)}`, {
      method: "POST",
      body: {
        mode: "approve",
        owner,
        channelId: channel.name,
        approvalText,
      },
    });
    state.modal = null;
    saveState();
    render();
    toast("审批已通过，结果已同步到实时数据源。", "success");
  } catch (error) {
    toast(error.message || "审批请求失败。", "warning");
  }
}

async function handleDockerAction(action) {
  if (action === "refresh") {
    await refreshDashboard();
    state.modal = { type: "docker" };
    saveState();
    renderModal();
    toast("Docker 状态已刷新。", "success");
    return;
  }

  const endpoint = action === "start" ? "/api/docker/start" : action === "stop" ? "/api/docker/stop" : null;
  if (!endpoint) {
    return;
  }

  try {
    runtime = await apiRequest(endpoint, {
      method: "POST",
    });
    state.modal = { type: "docker" };
    saveState();
    render();
    toast(action === "start" ? "Docker 启动请求已发送。" : "Docker 停止请求已发送。", "success");
  } catch (error) {
    toast(error.message || "Docker 动作执行失败。", "warning");
  }
}

async function handleDockerCopySubmit(form) {
  const fileInput = form.querySelector('input[name="uploadFile"]');
  const selectedFile = fileInput?.files?.[0];
  const formData = new FormData(form);
  const containerId = String(formData.get("containerId") || "").trim();
  const destinationPath = String(formData.get("destinationPath") || "").trim();

  if (!containerId) {
    toast("请选择目标容器。", "warning");
    return;
  }
  if (!destinationPath) {
    toast("请填写容器内目标路径。", "warning");
    return;
  }
  if (!selectedFile) {
    toast("请先选择要传输的文件。", "warning");
    return;
  }

  try {
    const fileContentBase64 = await fileToBase64(selectedFile);
    runtime = await apiRequest("/api/docker/copy", {
      method: "POST",
      body: {
        containerId,
        destinationPath,
        fileName: selectedFile.name,
        fileContentBase64,
      },
    });
    state.dockerForm.containerId = containerId;
    state.dockerForm.destinationPath = destinationPath;
    state.modal = { type: "docker" };
    saveState();
    render();
    toast(`已把 ${selectedFile.name} 发送到容器。`, "success");
  } catch (error) {
    toast(error.message || "文件传输到 Docker 失败。", "warning");
  }
}

function render() {
  syncFormControls();
  renderTopbar();
  renderHero();
  renderNodeFilters();
  renderNodeGrid();
  renderNodeDetail();
  renderBotSurface();
  renderRoutingPreview();
  renderDoctorSummary();
  renderDoctorAlerts();
  renderRevisionLedger();
  renderPhaseTimeline();
  renderPolicyTable();
  renderActivityFeed();
  renderModal();
}

function renderTopbar() {
  const docker = getDockerSummary();
  refs.dockerMenuSummary.textContent = dockerTopbarLabel(docker);
  refs.dockerMenuSummary.className = `topbar-badge ${docker.status}`;
  refs.dockerMenuButton.title = docker.detail || "Open Docker control";
}

function renderHero() {
  const openAlerts = runtime.alerts.filter((alert) => alert.status !== "resolved");
  const m4Node = getNode("m4");
  const availableExecutors = 1 + (m4Node?.status === "healthy" ? 1 : 0);
  const refreshedLabel = runtime.generatedAt
    ? new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(runtime.generatedAt))
    : "not synced";

  refs.hero.innerHTML = `
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">Control Plane</p>
        <h2>M2 holds the truth. Everyone else executes.</h2>
        <p class="lede">
          当前界面已经按附件方案校正：所有入口、会话、绑定与权限只在 M2 上存在一份，
          Mac Studio 只做重型执行，M4 只是在线即加入的算力补位，Doctor 独立负责健康治理。
        </p>
        <div class="hero-callout">
          <span>${runtime.sourceMode === "live" ? "Live data source" : "Fallback data source"}</span>
          <strong>${runtime.sourceMode === "live" ? `Last sync ${refreshedLabel}` : "Single-source Gateway on MacBook Pro M2"}</strong>
        </div>
      </div>
      <div class="hero-metrics">
        <article class="metric-card">
          <p class="metric-label">Gateway Truth Source</p>
          <p class="metric-value">1</p>
          <p class="metric-note">唯一控制面固定在 M2，避免多中心与双重会话真相源。</p>
        </article>
        <article class="metric-card">
          <p class="metric-label">Executors Online</p>
          <p class="metric-value">${availableExecutors}</p>
          <p class="metric-note">Mac Studio 走远端快照源，M4 burst 路由当前${runtime.m4DispatchEnabled ? "已启用" : "未启用"}。</p>
        </article>
        <article class="metric-card">
          <p class="metric-label">Open Alerts</p>
          <p class="metric-value">${openAlerts.length}</p>
          <p class="metric-note">Doctor 只处理治理面问题，不参与普通业务编排。</p>
        </article>
        <article class="metric-card">
          <p class="metric-label">Repo / Sources</p>
          <p class="metric-value">${runtime.repo.branch || "unknown"}</p>
          <p class="metric-note">未提交变更 ${runtime.repo.dirtyCount ?? 0} 项；远端节点源：${runtime.dataSources.remoteNodes}。</p>
        </article>
      </div>
    </div>
  `;
}

function renderNodeFilters() {
  const filters = [
    { id: "all", label: "全部节点" },
    { id: "control", label: "控制面" },
    { id: "execution", label: "执行面" },
    { id: "elastic", label: "弹性节点" },
    { id: "edge", label: "边缘辅助" },
  ];

  refs.nodeFilters.innerHTML = filters
    .map(
      (filter) => `
        <button
          class="chip ${state.nodeFilter === filter.id ? "active" : ""}"
          type="button"
          data-filter="${filter.id}"
        >
          ${filter.label}
        </button>
      `,
    )
    .join("");
}

function renderNodeGrid() {
  const nodes = getNodes().filter((node) => state.nodeFilter === "all" || node.group === state.nodeFilter);

  refs.nodeGrid.innerHTML = nodes
    .map(
      (node) => `
        <article
          class="node-card ${state.selectedNodeId === node.id ? "selected" : ""} ${node.status}"
          data-node-id="${node.id}"
        >
          <div class="node-card-header">
            <div>
              <div class="node-meta">
                <span class="node-role">${labelForGroup(node.group)}</span>
                <span class="status-pill">${statusLabel(node.status)}</span>
              </div>
              <h3>${node.name}</h3>
              <p class="muted-copy">${node.location}</p>
            </div>
            ${
              node.id === "m4"
                ? `<button class="status-button" type="button" data-toggle-node="m4">
                    ${runtime.m4DispatchEnabled ? "Disable Burst" : "Enable Burst"}
                  </button>`
                : ""
            }
          </div>
          <p class="card-copy">${node.summary}</p>
          ${node.runtimeSummary ? `<p class="policy-copy">${node.runtimeSummary}</p>` : ""}
          <div class="node-meta">
            ${node.metrics.map((metric) => `<span class="inline-pill">${metric}</span>`).join("")}
          </div>
          <ul class="tiny-list">
            ${node.carry.slice(0, 2).map((entry) => `<li>${entry}</li>`).join("")}
          </ul>
        </article>
      `,
    )
    .join("");
}

function renderNodeDetail() {
  const node = getNode(state.selectedNodeId);
  if (!node) {
    refs.nodeDetail.innerHTML = "";
    return;
  }

  refs.nodeDetail.innerHTML = `
    <article class="detail-card">
      <div class="detail-topline">
        <div>
          <div class="detail-meta">
            <span class="node-role">${labelForGroup(node.group)}</span>
            <span class="status-pill">${statusLabel(node.status)}</span>
          </div>
          <h3>${node.name}</h3>
          <p class="muted-copy">${node.role}</p>
        </div>
        <span class="inline-pill">${node.location}</span>
      </div>
      <p class="card-copy">${node.summary}</p>
      ${node.runtimeSummary ? `<p class="policy-copy">${node.runtimeSummary}</p>` : ""}
      <div class="detail-meta">
        ${node.metrics.map((metric) => `<span class="inline-pill">${metric}</span>`).join("")}
        ${node.source ? `<span class="inline-pill">Source ${node.source}</span>` : ""}
        ${node.lastSeen ? `<span class="inline-pill">Seen ${node.lastSeen}</span>` : ""}
      </div>
      <div class="mini-divider"></div>
      <p class="mini-label">Recommended Payloads</p>
      <ul class="detail-list">
        ${node.carry.map((entry) => `<li>${entry}</li>`).join("")}
      </ul>
      <p class="mini-label">Must Not Hold</p>
      <ul class="detail-list">
        ${node.avoid.map((entry) => `<li>${entry}</li>`).join("")}
      </ul>
    </article>
  `;
}

function renderBotSurface() {
  refs.botSurface.innerHTML = BOTS.map((bot) => {
    const active = state.form.botId === bot.id ? "active" : "";
    return `
      <article class="bot-card ${active}">
        <div class="bot-meta">
          <span class="inline-pill">${bot.surface}</span>
          <span class="inline-pill">Routes to M2 Gateway</span>
        </div>
        <h3>${bot.name}</h3>
        <p class="card-copy">${bot.description}</p>
        <div class="bot-actions">
          <button class="secondary-button" type="button" data-bot-id="${bot.id}">
            Use This Persona
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function renderRoutingPreview() {
  const plan = computeRoutingPlan();

  refs.routingPreview.innerHTML = `
    <article class="preview-card">
      <span class="preview-status ${plan.blocked ? "blocked" : "ready"} inline-pill">
        ${plan.blocked ? "Policy blocked" : "Ready to dispatch"}
      </span>
      <h3>${plan.agent.name} via ${plan.bot.name}</h3>
      <p class="card-copy">${plan.summary}</p>
      <div class="preview-meta">
        <span class="inline-pill">Control: ${plan.controlNode.name}</span>
        <span class="inline-pill">Execution: ${plan.executionNode.name}</span>
        <span class="inline-pill">Channel: ${plan.channel.name}</span>
      </div>
      <div class="mini-divider"></div>
      <p class="mini-label">Request brief</p>
      <p class="policy-copy">${escapeHtml(state.form.brief.trim() || "尚未填写请求摘要。")}</p>
      <div class="mini-divider"></div>
      <p class="mini-label">Why this route</p>
      <ul class="guardrail-list">
        ${plan.reasons.map((reason) => `<li>${reason}</li>`).join("")}
      </ul>
      <p class="mini-label">Guardrails</p>
      <ul class="guardrail-list">
        ${plan.guardrails.map((guardrail) => `<li>${guardrail}</li>`).join("")}
      </ul>
      ${
        plan.blocked
          ? `<div class="mini-divider"></div><p class="policy-copy">${plan.blockReason}</p>`
          : ""
      }
    </article>
  `;
}

function renderDoctorSummary() {
  const openAlerts = runtime.alerts.filter((alert) => alert.status !== "resolved");
  const autoEligible = openAlerts.filter((alert) => alert.severity === "low").length;
  const gated = openAlerts.filter((alert) => alert.severity !== "low").length;

  refs.doctorSummary.innerHTML = `
    <div class="summary-grid">
      <article class="summary-card">
        <h3>Open incidents</h3>
        <p>${openAlerts.length} 条治理面异常仍在观察或待处理。</p>
      </article>
      <article class="summary-card">
        <h3>Auto-remediation</h3>
        <p>${autoEligible} 条低风险动作可以立即执行并自动留痕。</p>
      </article>
      <article class="summary-card">
        <h3>Approval gates</h3>
        <p>${gated} 条动作仍需要私有入口、限频或人工审批。</p>
      </article>
    </div>
  `;
}

function renderDoctorAlerts() {
  refs.doctorAlerts.innerHTML = runtime.alerts
    .map((alert) => {
      const node = getNode(alert.nodeId);
      const resolved = alert.status === "resolved";
      const actionButton =
        resolved
          ? ""
          : alert.severity === "low"
            ? `<button class="primary-button" type="button" data-alert-action="resolve-low" data-alert-id="${alert.id}">Run auto-fix</button>`
            : `<button class="secondary-button" type="button" data-alert-action="review" data-alert-id="${alert.id}">${alert.severity === "high" ? "Approve action" : "Review action"}</button>`;

      return `
        <article class="alert-card">
          <div class="alert-headline">
            <div>
              <div class="alert-meta">
                <span class="severity-pill ${resolved ? "low" : alert.severity}">${resolved ? "resolved" : alert.severity}</span>
                <span class="inline-pill">${alert.domain}</span>
                <span class="inline-pill">${node ? node.name : "Unknown node"}</span>
              </div>
              <h3>${alert.title}</h3>
            </div>
            <span class="status-pill">${resolved ? "Recovered" : "Open"}</span>
          </div>
          <p class="card-copy">${alert.notes}</p>
          <p class="policy-copy"><strong>${alert.actionLabel}</strong></p>
          <div class="alert-actions">
            ${actionButton}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRevisionLedger() {
  refs.revisionLedger.innerHTML = `
    <div class="revision-grid">
      ${REVISION_CARDS.map(
        (card) => `
          <article class="revision-card">
            <p class="mini-label">Updated Principle</p>
            <h3>${card.title}</h3>
            <p class="timeline-copy">${card.body}</p>
          </article>
        `,
      ).join("")}
    </div>
  `;
}

function renderPhaseTimeline() {
  refs.phaseTimeline.innerHTML = `
    <div class="phase-grid">
      ${PHASES.map(
        (phase) => `
          <article class="phase-card">
            <p class="mini-label">${phase.name}</p>
            <h3>${phase.title}</h3>
            <p class="timeline-copy">${phase.summary}</p>
            <div class="mini-divider"></div>
            <p class="policy-copy">${phase.done}</p>
          </article>
        `,
      ).join("")}
    </div>
  `;
}

function renderPolicyTable() {
  refs.policyTable.innerHTML = APPROVAL_POLICIES.map(
    (policy) => `
      <article class="policy-row">
        <div class="alert-meta">
          <span class="severity-pill ${policy.risk}">${policy.title}</span>
        </div>
        <h3>${policy.rules}</h3>
        <p class="policy-copy">${policy.action}</p>
      </article>
    `,
  ).join("");
}

function renderActivityFeed() {
  refs.activityFeed.innerHTML = runtime.activities
    .map(
      (activity) => `
        <article class="activity-item">
          <div class="activity-headline">
            <div>
              <span class="activity-badge">${activity.badge}</span>
              <h3>${escapeHtml(activity.title)}</h3>
            </div>
            <span class="timestamp">${activity.timestamp}</span>
          </div>
          <p class="timeline-copy">${escapeHtml(activity.body)}</p>
          <div class="activity-meta">${activity.status}</div>
        </article>
      `,
    )
    .join("");
}

function renderModal() {
  if (!state.modal) {
    refs.modalHost.innerHTML = "";
    return;
  }

  if (state.modal.type === "docker") {
    renderDockerModal();
    return;
  }

  const alert = getAlert(state.modal.alertId);
  if (!alert) {
    state.modal = null;
    refs.modalHost.innerHTML = "";
    return;
  }

  const policy = APPROVAL_POLICIES.find((entry) => entry.risk === alert.severity);

  refs.modalHost.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-card">
        <div class="alert-meta">
          <span class="severity-pill ${alert.severity}">${policy ? policy.title : alert.severity}</span>
          <span class="inline-pill">${getNode(alert.nodeId)?.name || "Unknown node"}</span>
        </div>
        <h3>${alert.actionLabel}</h3>
        <p>${alert.notes}</p>
        <form class="modal-form" id="approvalForm">
          <input type="hidden" name="alertId" value="${alert.id}" />
          <div class="modal-grid">
            <label>
              Responsible Owner
              <input name="owner" placeholder="例如：leo" />
            </label>
            <label>
              Approval Channel
              <select name="channelId">
                ${CHANNELS.filter((channel) => channel.scope === "private")
                  .map((channel) => `<option value="${channel.id}">${channel.name}</option>`)
                  .join("")}
              </select>
            </label>
          </div>
          ${
            alert.severity === "high"
              ? `
                <label>
                  Confirmation Phrase
                  <input
                    name="approvalText"
                    placeholder="${alert.approvalPhrase}"
                  />
                </label>
              `
              : ""
          }
          <label class="checkbox-row">
            <input type="checkbox" name="privateAck" />
            <span>我确认当前动作来自私有入口，且已理解该动作会触及治理面或恢复面。</span>
          </label>
          <div class="modal-actions">
            <button class="primary-button" type="submit">Approve and run</button>
            <button class="secondary-button" type="button" data-close-modal>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderDockerModal() {
  const docker = getDockerSummary();
  const containers = Array.isArray(docker.containers) ? docker.containers : [];
  const canCopy = Boolean(docker.running && containers.length);
  const canStart = docker.status !== "running" && docker.status !== "not-installed";
  const canStop = Boolean(docker.running);
  const selectedContainerId =
    state.dockerForm.containerId && containers.some((entry) => entry.id === state.dockerForm.containerId)
      ? state.dockerForm.containerId
      : containers[0]?.id || "";

  state.dockerForm.containerId = selectedContainerId;
  if (!state.dockerForm.destinationPath) {
    state.dockerForm.destinationPath = "/tmp/";
  }

  refs.modalHost.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-card">
        <div class="alert-meta">
          <span class="severity-pill ${dockerSeverityClass(docker.status)}">${escapeHtml(docker.status)}</span>
          <span class="inline-pill">${docker.contextName || "docker context unavailable"}</span>
          <span class="inline-pill">${docker.runningCount || 0} running</span>
        </div>
        <h3>Local Docker Control</h3>
        <p>${escapeHtml(docker.detail || "Use this panel to control Docker Desktop and send files into local containers.")}</p>
        <div class="docker-modal-stack">
          <div class="docker-status-grid">
            <article class="docker-card">
              <p class="mini-label">Client</p>
              <h4>${escapeHtml(docker.clientVersion || "not detected")}</h4>
              <p>${docker.appInstalled ? "Docker Desktop installed" : "Docker Desktop not found in /Applications"}</p>
            </article>
            <article class="docker-card">
              <p class="mini-label">Daemon</p>
              <h4>${docker.running ? "Reachable" : "Unavailable"}</h4>
              <p>${escapeHtml(docker.serverVersion || "server version unavailable")}</p>
            </article>
            <article class="docker-card">
              <p class="mini-label">Containers</p>
              <h4>${containers.length}</h4>
              <p>${docker.running ? "Enumerated from docker ps -a" : "Start Docker to enumerate containers"}</p>
            </article>
          </div>
          <div class="modal-actions">
            <button class="primary-button" type="button" data-docker-action="start" ${canStart ? "" : "disabled"}>
              Start Docker
            </button>
            <button class="secondary-button" type="button" data-docker-action="stop" ${canStop ? "" : "disabled"}>
              Stop Docker
            </button>
            <button class="secondary-button" type="button" data-docker-action="refresh">Refresh Status</button>
            <button class="secondary-button" type="button" data-close-modal>Close</button>
          </div>
          <div class="mini-divider"></div>
          <div>
            <p class="mini-label">Containers</p>
            ${
              containers.length
                ? `<div class="docker-container-list">
                    ${containers
                      .map(
                        (container) => `
                          <button
                            class="docker-container-card ${container.id === selectedContainerId ? "selected" : ""}"
                            type="button"
                            data-select-container="${escapeHtml(container.id)}"
                            title="Use ${escapeHtml(container.name || container.id)} as the upload target"
                          >
                            <div class="alert-meta">
                              <span class="inline-pill">${escapeHtml(container.name || container.id)}</span>
                              <span class="severity-pill ${container.state === "running" ? "low" : "medium"}">${escapeHtml(container.state || "unknown")}</span>
                            </div>
                            <h4>${escapeHtml(container.image || "unknown image")}</h4>
                            <p>${escapeHtml(container.status || "No status text returned by docker.")}</p>
                          </button>
                        `,
                      )
                      .join("")}
                  </div>`
                : `<div class="docker-empty">当前还没有可见容器。Docker 未运行、权限不足，或者本机还没有任何容器时都会出现这种状态。</div>`
            }
          </div>
          <div class="mini-divider"></div>
          <form class="modal-form" id="dockerCopyForm">
            <div class="modal-grid">
              <label>
                Target Container
                <select name="containerId" ${canCopy ? "" : "disabled"}>
                  ${
                    containers.length
                      ? containers
                          .map(
                            (container) => `
                              <option value="${escapeHtml(container.id)}" ${container.id === selectedContainerId ? "selected" : ""}>
                                ${escapeHtml(container.name || container.id)} · ${escapeHtml(container.image || "")}
                              </option>
                            `,
                          )
                          .join("")
                      : `<option value="">No containers available</option>`
                  }
                </select>
              </label>
              <label>
                Destination Path
                <input
                  name="destinationPath"
                  value="${escapeHtml(state.dockerForm.destinationPath)}"
                  placeholder="/tmp/your-file.txt"
                  ${canCopy ? "" : "disabled"}
                />
              </label>
            </div>
            <label class="file-picker">
              Select File
              <input name="uploadFile" type="file" ${canCopy ? "" : "disabled"} />
            </label>
            <p class="policy-copy">
              文件会通过浏览器上传到本地 API，然后执行 <code>docker cp</code> 复制进目标容器。若目标以 <code>/</code> 结尾，会自动附加原文件名。
            </p>
            <p class="muted-copy">
              点击上方容器卡片可以快速切换目标容器。只有当 daemon 可达且容器列表已加载时，文件投递表单才会解锁。
            </p>
            <div class="modal-actions">
              <button class="primary-button" type="submit" ${canCopy ? "" : "disabled"}>
                Send File Into Container
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function computeRoutingPlan() {
  const bot = getBot(state.form.botId);
  const channel = getChannel(state.form.channelId);
  const request = getRequestType(state.form.requestTypeId);
  const load = getLoad(state.form.loadId);
  const agent = request ? AGENTS[request.agentId] : AGENTS.pm;
  const controlNode = getNode("gateway-m2");
  const executionNode = determineExecutionNode(agent.id, load.id);

  const reasons = [
    "所有 Bot 表象最终都汇聚到同一个 M2 Gateway，避免出现多个独立中心。",
    agent.id === "doctor"
      ? "Doctor 只在治理面做观察与修复决策，不参与普通业务编排。"
      : `${agent.name} 的控制决策由 ${controlNode.name} 持有，执行再按负载下沉。`,
    executionNode.id === "m4"
      ? "当前 M4 在线，可承接 burst 型短时高负载任务。"
      : executionNode.id === "studio"
        ? "重任务与代码执行优先交给 Mac Studio，避免挤占 M2 控制面。"
        : "该类任务应常驻在 M2 上保持会话与决策连续性。",
  ];

  const guardrails = [
    "Ops 与 Doctor 只允许从私有入口触发，不进入公共频道。",
    "高风险动作必须人工审批；中风险动作必须限频并留痕。",
    "M4 只作为在线即加入的弹性节点，不保存唯一配置和会话状态。",
  ];

  let blocked = false;
  let blockReason = "";

  if (agent.privateOnly && channel.scope !== "private") {
    blocked = true;
    blockReason = `${agent.name} 只能在私有入口触发，当前所选频道 ${channel.name} 不符合治理策略。`;
  }

  if (!blocked && !channel.allows.includes(agent.id)) {
    blocked = true;
    blockReason = `${channel.name} 默认不开放给 ${agent.name}，请改用私有入口或更低权限 Agent。`;
  }

  if (!blocked && channel.scope === "public" && agent.id === "coder" && load.id !== "interactive") {
    blocked = true;
    blockReason = "公共频道只允许低风险 Coder 请求；重任务或突发负载请转到私有入口。";
  }

  return {
    bot,
    channel,
    request,
    load,
    agent,
    controlNode,
    executionNode,
    blocked,
    blockReason,
    reasons,
    guardrails,
    summary: blocked
      ? "当前选择会触发治理边界，系统会阻止请求进入执行面。"
      : `${request.label} 将经由 ${bot.name} 进入 M2 控制面，再由 ${executionNode.name} 承接实际负载。`,
  };
}

function determineExecutionNode(agentId, loadId) {
  if (agentId === "pm" || agentId === "research" || agentId === "doctor") {
    return getNode("gateway-m2");
  }

  if (agentId === "ops") {
    return getNode("studio");
  }

  if (agentId === "coder" && loadId === "burst" && runtime.m4DispatchEnabled && getNode("m4")?.status === "healthy") {
    return getNode("m4");
  }

  return getNode("studio");
}

function getNodes() {
  return NODE_BLUEPRINTS.map((node) => {
    const runtimeNode = runtime.nodes.find((entry) => entry.id === node.id);
    if (!runtimeNode) {
      return node;
    }

    return {
      ...node,
      status: runtimeNode.status || node.status,
      metrics: Array.isArray(runtimeNode.metrics) && runtimeNode.metrics.length ? runtimeNode.metrics : node.metrics,
      runtimeSummary: runtimeNode.runtimeSummary,
      source: runtimeNode.source,
      lastSeen: runtimeNode.lastSeen,
    };
  });
}

function getNode(nodeId) {
  return getNodes().find((node) => node.id === nodeId);
}

function getAlert(alertId) {
  return runtime.alerts.find((alert) => alert.id === alertId);
}

function getBot(botId) {
  return BOTS.find((bot) => bot.id === botId) || BOTS[0];
}

function getChannel(channelId) {
  return CHANNELS.find((channel) => channel.id === channelId) || CHANNELS[0];
}

function getRequestType(requestId) {
  return REQUEST_TYPES.find((request) => request.id === requestId) || REQUEST_TYPES[0];
}

function getLoad(loadId) {
  return LOADS.find((load) => load.id === loadId) || LOADS[0];
}

function getDockerSummary() {
  return runtime.docker || createFallbackRuntime().docker;
}

function populateSelect(select, list, valueKey, labelKey) {
  select.innerHTML = list
    .map((entry) => `<option value="${entry[valueKey]}">${entry[labelKey]}</option>`)
    .join("");
}

function syncFormControls() {
  refs.botSelect.value = state.form.botId;
  refs.channelSelect.value = state.form.channelId;
  refs.requestSelect.value = state.form.requestTypeId;
  refs.loadSelect.value = state.form.loadId;
  refs.requestBrief.value = state.form.brief;
}

function createActivity({ kind, status, badge, title, body }) {
  return {
    id: self.crypto?.randomUUID?.() || String(Date.now() + Math.random()),
    kind,
    status,
    badge,
    title,
    body,
    timestamp: new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date()),
  };
}

function statusLabel(status) {
  if (status === "healthy") {
    return "healthy";
  }
  if (status === "standby") {
    return "standby";
  }
  if (status === "watching") {
    return "watching";
  }
  if (status === "warning") {
    return "warning";
  }
  return status;
}

function labelForGroup(group) {
  if (group === "control") {
    return "control";
  }
  if (group === "execution") {
    return "execution";
  }
  if (group === "elastic") {
    return "elastic";
  }
  return "edge";
}

function saveState() {
  const persisted = {
    ...state,
    modal: null,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function loadState() {
  const base = createDefaultState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return base;
    }

    const parsed = JSON.parse(raw);
    return {
      ...base,
      selectedNodeId: parsed.selectedNodeId || base.selectedNodeId,
      nodeFilter: parsed.nodeFilter || base.nodeFilter,
      form: {
        ...base.form,
        ...(parsed.form || {}),
      },
      dockerForm: {
        ...base.dockerForm,
        ...(parsed.dockerForm || {}),
      },
      modal: null,
    };
  } catch {
    return base;
  }
}

async function refreshDashboard(options = {}) {
  try {
    runtime = await apiRequest("/api/dashboard");
    render();
    return runtime;
  } catch (error) {
    if (!options.silent) {
      toast(error.message || "实时数据源不可用，已回退到本地预设。", "warning");
    }
    render();
    return runtime;
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }

  return payload;
}

function dockerTopbarLabel(docker) {
  if (docker.status === "running") {
    return `${docker.runningCount || 0} running`;
  }
  if (docker.status === "stopped") {
    return "Stopped";
  }
  if (docker.status === "permission-denied") {
    return "No socket access";
  }
  if (docker.status === "not-installed") {
    return "Not installed";
  }
  return "Checking";
}

function dockerSeverityClass(status) {
  if (status === "running") {
    return "low";
  }
  if (status === "stopped" || status === "permission-denied") {
    return "medium";
  }
  return "high";
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

function toast(message, tone = "default") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = message;
  refs.toastHost.appendChild(node);

  window.setTimeout(() => {
    node.remove();
  }, 2600);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
