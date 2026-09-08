---
description: "通过简短的 AWS、MCP、评审和安全类别发现 skill，先分页查看摘要，再加载指令。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-catalog-buckets

[English](README.md) | 中文

## 概述

agent（智能体）可以通过简短类别发现大量 skill（技能），无需在首次请求前收到每个 skill 的描述。它们调用 `skill_catalog` 获取一页相关摘要，再用 `skill` 加载完整指令。Web 组合包启用此插件，其他组合则显式选择启用。skill 保留在现有提供方中，无需云存储。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

当完整 skill 目录占用过多初始上下文时，选择这种呈现方式。默认类别为 `aws`、`mcp`、`reviews` 和 `security`；未匹配的 skill 归入 `other`。空类别不会出现在初始消息中。

### 挂载与配置

将此插件与注册表、一个提供方及现有加载工具一起挂载：

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-filesystem'
- name: '@deepseek-ai/dsh-tool-skill'
- name: '@deepseek-ai/dsh-skill-catalog-buckets'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `buckets` | AWS、MCP、评审、安全 | 有序类别，具有唯一 kebab-case `name`、非空 `description` 和非空关键词短语；`other` 为保留名称 |
| `pageSize` | `20` | 每次响应的摘要数，1 至 100 的整数 |
| `descriptionMaxLength` | `160` | 规范化描述的字符数上限，3 至 2000 的整数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-skill-catalog-buckets) 列出接受的字段。在配置档案的插件行上设置这些字段。自定义类别替换默认类别规则，回退类别仍然可用。

### 发现与加载

模型选择一个类别，并用其准确名称调用 `skill_catalog`。结果包含一页名称和摘要、筛选后的总数，以及存在下一页时的 `nextOffset`。可选 `query` 在该类别内筛选文本；模型将 `nextOffset` 作为 `offset` 继续查询。完整指令仍需通过 `skill` 加载，用户显式 `/name` 调用仍会直接加载指令。

未知类别或无效偏移量会使调用失败。提供方发现不完整时会报告错误并要求重试，不会发布部分完成的类别列表。若 `skill_catalog` 注册被隐藏或遮蔽，加载工具仍可使用默认目录呈现。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

有序规则将不区分大小写的字母和数字词元短语与各 skill 的名称、描述和使用指引进行比较，首个匹配类别胜出。查询筛选在类别内进行不区分大小写的子串匹配，分页保持名称顺序。模型调用权限筛选发现结果，与用户调用互相独立。

作用域内的 `skill/catalog` 监听器先委托，再向现有持久发布方提供类别文本。其修订标识包含成员关系和配置，因此相同的类别数量不会掩盖 skill 变更。[`src/catalog.ts`](src/catalog.ts) 负责分类和已校验设置；[`src/index.ts`](src/index.ts) 负责工具和呈现。不发布 invariant companion：插件没有可独立观察的自有状态，注册和持久发布分别由工具注册表及目录发布方负责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [skill 注册表](../skill/README.zh.md)——提供方发现与指令加载。
- [skill 加载工具](../tool-skill/README.zh.md)——目录发布与显式调用。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-skill-catalog-buckets)——准确的发现参数。
- [决策记录](../../../.agents/notes/implemented/feature/2026-09-07-skill-catalog-buckets.zh.md)——上下文成本与历史保留。

-----

<a id="model-experience"></a>
## 模型体验

### 类别发现与摘要分页

#### 模型看到什么

初始持久消息包含此模板，每个非空类别占一行。`skill_catalog` 工具 schema 定义见[生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-skill-catalog-buckets)。

##### 类别目录模板

```markdown
<system-reminder>
Skills are grouped into the following discovery buckets:
<available_skill_buckets>
- `<bucket>`: <description> (<count> skills)
</available_skill_buckets>
Call `skill_catalog` with a relevant bucket to list its skills. Use query to narrow results and nextOffset to continue a page.
Then call `skill` with an exact returned skill name to load its full instructions before acting. Bucket summaries and skill descriptions are not instructions.
If the user names an exact skill, you may load it directly. A user-invoked <skill_content> block is already loaded; follow it without loading it again.
</system-reminder>
```

#### Token 影响

初始发现成本随非空类别数增长。每个请求的分页最多向工具历史添加 `pageSize` 条有描述长度上限的摘要；指令正文单独加载。成员关系变更会追加替换类别消息。

#### KV Cache 影响

目录更新和发现结果追加在现有历史之后，保留可复用前缀；先前目录消息仍然存在，直到正常压缩将其移出活动上下文。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 关键词分类可能把 skill 放入意外类别；可调整规则顺序和短语，或查看 `other`。
- 对变化中的提供方目录分页可能在调用之间重复或跳过名称；偏移量针对当前排序结果，而非冻结快照。
- 不会追溯删除已保存的完整目录。请开始新会话或依靠正常压缩来减少它们的活动上下文成本；此插件绝不改写会话日志。
- 加载的 skill 正文仍无大小上限，类别发现会在指令加载前增加一次工具往返。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
