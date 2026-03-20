# AI Monitor Hub

AI Monitor Hub 现在被补成了一个带本地 API 的可运行控制台，用来展示并操作附件 `openclaw_architecture_plan.pdf` 中收敛后的 OpenClaw 协同工作系统。

这个版本重点完成了两件事：

- 把附件里的架构结论落成统一信息模型：`M2` 是唯一常驻 Gateway 和 Doctor 平面，`Mac Studio` 负责重型执行与模型服务，`M4` 只是在线即加入的弹性节点，多个 Bot 统一映射到同一个 Gateway。
- 把“原本应有但未闭环”的交互补齐成可用流程：节点选择、任务路由推演、私有入口限制、Doctor 风险分级修复、人工审批、活动回放。
- 把纯前端假数据替换为真实运行态：M2 读取本机实时系统指标和仓库状态，远端节点读取可配置快照文件，交互动作落盘到本地运行态文件。

## 交互范围

- 节点拓扑面板
  - 查看 M2 / Mac Studio / M4 / 边缘节点职责
  - 切换筛选
  - 切换 `M4` 在线 / 待命状态
- 路由工作台
  - 选择 Bot、频道、任务类型、负载类型
  - 实时推演控制面与执行面落点
  - 在不合规路径上阻止提交
- Doctor 治理平面
  - 区分低 / 中 / 高风险动作
  - 低风险动作立即执行
  - 中高风险动作进入审批面板
  - 高风险动作要求人工确认短语
- Docker 菜单栏控制
  - 查看本机 Docker Desktop / daemon / 容器状态
  - 在控制台内启动或停止本地 Docker
  - 把选中的本地文件复制进目标容器
  - 通过点击容器卡片快速切换文件投递目标
- 架构修订信息
  - 展示根据附件修正后的核心原则
  - 展示阶段落地计划与权限治理矩阵

## 运行方式

零依赖本地服务，不需要安装第三方包。

```bash
npm run dev
```

默认会在当前目录启动一个本地 API + 静态资源服务器。

也可以直接构建静态产物：

```bash
npm run build
```

构建结果会输出到 `dist/`，预览仍通过本地 `server.mjs` 提供 API。

## 文件结构

- `index.html`: 页面骨架
- `styles.css`: 界面样式与响应式布局
- `app.js`: 前端交互逻辑、轮询与 API 调用
- `server.mjs`: 本地 API、实时指标采集、运行态持久化，以及本机 Docker 状态/控制
- `data/remote-node-snapshots.example.json`: 远端节点快照格式示例
- `data/node-snapshots/`: 每个远端节点独立写入自己的实时快照文件
- `scripts/report-node-snapshot.mjs`: 远端节点上报脚本
- `scripts/generate-launchd-plist.mjs`: 生成远端节点的 launchd plist
- `ops/launchd/`: 现成的 Studio / M4 plist 样例与安装说明
- `scripts/build.mjs`: 零依赖构建脚本

## 真实数据源

当前已经接好的数据源分两层：

- 本机实时源
  - `server.mjs` 会读取当前机器的负载、内存、磁盘、电源状态
  - 同时读取当前仓库分支和未提交改动数量
  - 这些信号会映射到 `gateway-m2` 节点和 Doctor 告警
- 远端节点快照源
  - 推荐方式是每台机器各自写入 `data/node-snapshots/<node-id>.json`
  - 兼容旧方式：也可以继续使用 `data/remote-node-snapshots.json`
  - 之后让每台机器或监控任务定期更新对应节点的 `updatedAt`、`online`、`cpuPercent`、`latencyMs`、`note`
- 本地运行态源
  - 用户动作会落盘到 `data/runtime-state.json`
  - 包括 `M4` burst 路由开关、审批结果、Doctor 处理记录、活动流
- 本机 Docker 源
  - 顶栏 Docker 菜单会调用本地 API 读取 Docker Desktop 与 daemon 状态
  - 可执行启动、停止以及向容器内复制文件
  - 文件传输通过浏览器上传到本地 API，再执行 `docker cp`

## 远端快照示例

`data/remote-node-snapshots.json` 结构示例：

```json
{
  "studio": {
    "updatedAt": "2026-03-20T16:20:00+08:00",
    "online": true,
    "cpuPercent": 46,
    "latencyMs": 128,
    "note": "Qwen host healthy"
  },
  "m4": {
    "updatedAt": "2026-03-20T16:18:00+08:00",
    "online": false,
    "cpuPercent": 0,
    "latencyMs": 0,
    "note": "Office machine offline"
  }
}
```

只要这个文件被持续刷新，前端就会自动轮询并显示最新状态。

## 节点上报脚本

推荐让每台远端机器写自己的快照文件，这样不会互相覆盖。

示例：

```bash
node scripts/report-node-snapshot.mjs --node-id studio
```

输出会直接打印 JSON。

如果远端机器能访问 M2 这份共享目录，就直接写入：

```bash
node scripts/report-node-snapshot.mjs \
  --node-id studio \
  --target-dir "/Users/leo/Library/Mobile Documents/com~apple~CloudDocs/Personal/Game Dev/New Monkey/AI-Monitor-Hub/data/node-snapshots" \
  --note "Qwen host healthy"
```

M4 的示例：

```bash
node scripts/report-node-snapshot.mjs \
  --node-id m4 \
  --target-dir "/Users/leo/Library/Mobile Documents/com~apple~CloudDocs/Personal/Game Dev/New Monkey/AI-Monitor-Hub/data/node-snapshots" \
  --note "Office machine available"
```

如果某台机器准备下线，也可以主动写离线快照：

```bash
node scripts/report-node-snapshot.mjs \
  --node-id m4 \
  --target-dir "/Users/leo/Library/Mobile Documents/com~apple~CloudDocs/Personal/Game Dev/New Monkey/AI-Monitor-Hub/data/node-snapshots" \
  --offline \
  --note "Office machine offline"
```

建议把这条命令放进 `launchd`、定时任务或登录项，每 1 到 3 分钟更新一次。

## launchd

如果目标机器上的工作区路径和 Node 路径与当前仓库一致，可以直接用：

- `ops/launchd/com.leo.ai-monitor-hub.studio.plist`
- `ops/launchd/com.leo.ai-monitor-hub.m4.plist`

如果不一致，建议在目标机器本地重新生成：

```bash
npm run launchd:generate -- \
  --node-id studio \
  --output ops/launchd/com.leo.ai-monitor-hub.studio.plist \
  --note "Mac Studio snapshot reporter"
```

完整安装命令见 `ops/launchd/README.md`。

## Docker 控制

顶栏新增了 `Docker Control` 按钮，会显示当前 Docker 状态。

后端提供以下能力：

- `GET /api/docker/status`
- `POST /api/docker/start`
- `POST /api/docker/stop`
- `POST /api/docker/copy`

其中 `docker/copy` 的请求体会包含：

```json
{
  "containerId": "your-container",
  "destinationPath": "/tmp/",
  "fileName": "example.txt",
  "fileContentBase64": "..."
}
```

如果 `destinationPath` 以 `/` 结尾，系统会自动拼接原文件名。

注意：

- 这套控制默认面向本机 Docker Desktop
- 启动使用 `open -a Docker`
- 停止使用 `osascript -e 'quit app "Docker"'`
- 文件复制使用 `docker cp`
- 启停动作会等待 daemon 状态实际变化几轮后再回写到界面，减少“命令已发出但状态还没变”的错觉

## 附件对齐后的关键信息

- 单一真相源固定在 `MacBook Pro M2`
- `Doctor` 独立于普通业务 Agent，不参与常规编排
- `Mac Studio` 不再承担主控，只提供重型执行与模型能力
- `MacBook Pro M4` 不保存任何不可替代状态
- 多个 Bot 只是外观层，统一接入同一个 Gateway

## 适合下一步继续扩展的方向

- 接入真实后端心跳与探针数据
- 把活动流和审批结果同步到真实告警频道
- 将任务路由规则抽离成配置文件或服务端策略
