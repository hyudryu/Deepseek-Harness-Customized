---
description: "从本地持久化会话读取历史 token 用量和已完成轮次的活动时间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-usage-controller

[English](README.md) | 中文

## 概述

读取本地持久化会话的总 token 数、每日峰值 token 数和最长会话的活动时长。每日记录按提供方和模型区分，并使用 UTC 日期。读取排除分支继承的事件，且不激活代理。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

此插件通过提供 Web 客户端的配置中的 Loader 条目挂载。它没有配置字段。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节 — 点击展开</summary>

[控制器](src/index.ts) 以只读方式打开持久化会话，并在聚合后关闭每个句柄。[计数函数](src/aggregate.ts) 独立统计每条消息或失败尝试的结算，保留重试报告的用量，并单独统计缺少用量的结算。继承的请求上下文为本地失败尝试提供路由信息。有效的 `totalTokens` 报告值是权威总量；未报告时，总量为输入、输出、缓存读取和缓存写入之和。报告的总量必须不小于已知互斥分项之和；两个缓存分项都存在时，必须等于各分项之和。推理 token 数不得超过输出 token 数。最长会话时长取各会话已完成轮次时长之和的最大值，排除空闲间隔和未完成轮次。

**运行时不变量：** 不发布配套模块，因为每次查询都从持久化数据派生结果，不保留独立的计数存储。

</details>

-----

<a id="model-experience"></a>
## Model Experience

None，因为此包只向用户显示用量，不注册提示词、工具或会话事件。

#### KV Cache effect

没有直接影响；读取用量不改变模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 总量只覆盖保留的本地历史，不代表提供方账单。缺失的用量，以及总量或推理计数不一致的用量，不计入总量，并通过 `missingUsageAttempts` 报告；持久化操作失败时读取失败，不返回部分汇总。崩溃中断的轮次不计入活动时长，因为其结束时间戳包含离线时间。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
