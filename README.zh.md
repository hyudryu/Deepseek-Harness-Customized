# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 自定义更新与插件

> **⚠️ 免责声明：**这些**不是** DeepSeek 官方功能或插件，而是此 fork 中面向 coding agent 工作流的个人扩展。请自行判断是否使用。

此 fork 为 DeepSeek Harness 添加了一项自定义更新，以及一组可安装的插件组合包。展开下列条目查看详情。

### DeepSeek Harness 更新

<details>
<summary><b>ui-workspace：供功能插件使用的 `sidebar.workspaces.actions` slot</b> — 点击展开</summary>

在工作区浏览器中声明根作用域的 `sidebar.workspaces.actions` 列表 slot，并通过 `workspaceMenuItems` hook 暴露，使功能插件可以向工作区行的三点菜单添加条目。`ProjectRowItem` 将扩展条目合并到内置的重命名/删除之前，并调用各条目的 `onSelect(workspaceId)`。添加了测试，并使 `Rows.tsx` 保持 100% 覆盖率。

</details>

### 插件

这些组合包位于 [`Custom Plugins/`](Custom Plugins/)。它们有意放在核心 `packages/` 树之外，通过 `dsh plugin --profile <name> add <path>` 按 profile 安装。

#### 1. `dsh-browser-control`

<details>
<summary><b>精简的 Playwright 浏览器控制插件</b> — 点击展开</summary>

一个精简的原生 Playwright 浏览器控制插件。它有意只提供一个 `browser` 工具，而不提供庞大的 MCP 工具目录，并提供包含交互策略、按需逐步加载的 `browser-control` skill（技能）。

能力包括：

- 为每个 Harness agent/会话保持持久的 Chromium 上下文；
- 按语义角色、标签、文本和 test-id 定位；
- 面向 AI（人工智能）的 ARIA 快照；
- 点击、填写、按键、选择、勾选和取消勾选；
- 带轮询的确定性断言；
- 控制台、页面、网络和 HTTP 诊断；
- 截图和响应式视口调整；
- 弹出窗口/标签页的列举与切换。

</details>

#### 2. `dsh-qa-testing`

<details>
<summary><b>感知 PR 的 QA 编排插件</b> — 点击展开</summary>

一个感知 PR（Pull Request）的 QA 编排插件。它提供 `qa_pr`，以及按需逐步加载的 `qa-testing` skill。

QA skill 指示 DeepSeek：

1. 检查 PR 是否已有 QA/测试章节（宽松匹配：`## QA Testing`、`QA section`、`QA test`、`Test steps`、`Testing` 等均算；忽略代码块）；
2. 仅当 PR 没有*可用的* QA/测试章节时，检查 PR 正文、差异、修改的文件及相邻代码，然后生成具体的 QA 检查清单；
3. 若 PR 已有可用的 QA/测试章节，将其复用/转换为机器管理的 `## QA Testing` 块，而不是从头推导；
4. 实时将各项状态更新为 PENDING/RUNNING/PASS/FAIL/BLOCKED；
5. 遇到 FAIL 时，携带确切的失败证据调用前台 `subagent_fork` coding agent；
6. coding agent 修复后，重新测试失败项；
7. 重复修复循环，最多达到配置的单项检查次数上限；
8. 完成任何修复后，针对最终 head 重新运行*整个*检查清单；
9. 只有在一次不中断的最终检查中所有项目均通过时，才将整体标记为 PASS。

PR 正文块在标记之间保存隐藏的 JSON 状态，使更新具有确定性并保留 PR 正文的其余部分。失败/通过的尝试历史对审阅者保持可见。

</details>

#### 3. `dsh-vision-router`

<details>
<summary><b>两阶段视觉路由器</b> — 点击展开</summary>

一个透明的模型路由器，为包含视觉输入的请求与纯文本请求选择处理模型。

每个模型请求的路由方式：

1. 若请求**不含图像**，将其路由到配置的**文本模型**（未配置时使用会话选定的模型）。
2. 若请求**包含图像**，路由器先将图像发送给配置的**视觉模型**，获取文字分析，再将该分析与原始请求一同交给**文本模型**。文本模型不会看到原始图像字节，因此可以将强大的纯文本模型与独立的视觉模型组合使用。

配置位于设置层：在 `$DSH_HOME/settings.yaml` 中添加 `vision-router:` 章节（热重载，无需重启）：

```yaml
vision-router:
  visionProvider: pi-ai          # provider of the vision-capable model
  visionModel: pi-vision-2       # vision-capable model id
  textProvider: deepseek         # optional; unset inherits the session model
  textModel: deepseek-v4-flash   # optional; unset inherits the session model
  visionPrompt: ''               # optional; empty = built-in default
  maxAnalysisChars: 20000        # cap on the vision analysis injected as text
```

也可以在 `cordis.patch.yml` 中设置相同字段，作为组合默认值。配置 `visionProvider`/`visionModel` 后路由即启用；此前路由器关闭，文本请求原样通过，但包含图像的请求会**明确报错**，因为未配置视觉目标时无法分析图像。无效的路由器设置会使任何请求失败，并给出可操作的错误，而不是静默禁用路由。这是路由器，不是工具；没有可调用的 `vision_router` 工具。

</details>

#### 4. `dsh-personal-assistant`

<details>
<summary><b>全局个人助理监督插件</b> — 点击展开</summary>

一个全局个人助理监督器（每个 Harness profile 一个）。它拥有名为 "Personal Assistant" 的专用控制会话，通过 Strands Agents SDK 推理循环监看每个编码会话：呈现会话中的完成、失败和提问，将你的回答送回对应会话，跨会话操作交互式 TUI 菜单，并持续监看 GitHub/Codex PR 审阅。它属于控制层，不是编码执行者；它自身不会编写或修改代码。

能力包括：

- 发现会话并分配确定性的易读名称（由首个任务、仓库或分支派生；显式重命名始终优先）；
- 完成状态分类：绝不将空闲等同于完成；确定性分类器根据会话自身输出区分 COMPLETED / INPUT_REQUIRED / FAILED / BLOCKED；
- 跨会话消息：空闲时 followup，运行时 inject，紧急时 steer；
- 受所有者隔离约束的 TUI 桥接（`tui_snapshot` / `tui_select` / `tui_keypress`，仅接受具名按键，拒绝含糊菜单而不猜测）；
- 精简的 `github_pr_review_state` 工具：检测主帖上的 Codex 点赞，并按时间线识别最新活动；
- 基于持久化 Harness 调度的持续审阅监看，并以进程内定时器作为后备；
- 全面去重，包括重启后也不会重复通知；
- 在提示词之外执行 Level-2 权限：每个监督器工具都受策略包装，在审批 UI 可用之前，破坏性操作或未列出的操作均以 `approval_required` 拒绝；
- 仅改变措辞、绝不改变行为的个性预设（`friendly`/`playful`/`professional`/`serious`/`minimal`/`custom`）。

**前置条件：**

- 已安装并完成身份验证的 GitHub CLI（命令行界面）（`gh`），用于监看 PR 审阅；
- 与 OpenAI 兼容的模型端点，供监督器循环使用（通过 `strands.baseUrl` / `strands.model` 配置；API 密钥在运行时从 `strands.apiKeyEnv` 指定的环境变量读取，绝不保存在配置中）。

</details>

#### 5. `dsh-mcp-servers`

<details>
<summary><b>MCP 服务器管理器</b> — 点击展开</summary>

一个负责管理部署中 MCP 服务器的插件：你可以在 **设置 → 插件 → MCP servers** 中添加、删除、启用、禁用和测试服务器，且每个已启用的服务器都会在会话启动时挂载到各个 agent 会话中。

能力包括：

- 两种传输方式——`stdio`（`command`/`args`/`env`/`cwd`）与流式 HTTP（`scheme`/`host`/`port`/`path`/`headers`）；
- 默认 15 秒超时的宿主端连接测试，会统计服务器的工具数量，并将结果以 `lastTest`（状态、工具数量、工具列表、消息、时间戳）写回设置；
- 在会话启动时自动挂载每个已启用的服务器，使该服务器的工具以 `mcp__<serverName>__<toolName>` 形式提供给 agent；挂载失败的服务器会被记录并跳过，而不是阻塞会话；
- 一个 `mcp_servers` 工具（`action=list`），用于报告已配置的服务器、各自是否启用及其上次连接测试结果——在未查看该结果前，绝不假定服务器或其工具可用；
- 一个按需逐步加载的 `mcp-servers` skill，用于指导发现、测试结果解读与管理的页面；
- 服务器定义存储在 `mcp.servers` 设置命名空间中，因此会持久化到磁盘上的 DSH 设置文档中。

</details>

#### 6. `dsh-project-secrets`

<details>
<summary><b>项目级密钥记事本</b> — 点击展开</summary>

一个为每个项目维护密钥块（凭据、API 密钥、令牌或其他仅属于该项目的值）的插件。它将密钥块以纯文本文件形式存储在项目目录中，并在 Web GUI 以及提供给 agent 的工具中呈现。

能力包括：

- 一个限定于项目工作目录的密钥文件，默认 `.dsh/project-secrets`（可通过 `secretsFile`、`maxBytes` 与 `root` 配置）；
- 各项目三点菜单上的 **Project Secrets** 项，用于打开弹窗粘贴/编辑密钥块，由 `/project-secrets/<workspaceId>` 上的 HTTP `GET`/`PUT` 支撑；
- 一个供 agent 使用的 `project_secrets` 工具（`action: read`/`write`），带字节数限制校验与原子写入（临时文件加重命名）；
- 一个按需逐步加载的 `project-secrets` skill，指示 agent 先读取、绝不将密钥回显到对话、提交或日志中、权威地写入并尊重项目边界；
- 将文件缺失安全地视为空。

</details>

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
