---
description: "从本地持久化会话读取历史 token 用量和已完成轮次的活动时间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-usage-controller

[English](README.md) | 中文

## 概述

读取本地持久化会话的总 token 数、每日峰值 token 数和最长会话的活动时长。每日记录按供应商和模型区分，并使用 UTC 日期。读取排除分支继承的事件，且不激活代理。

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

[控制器](src/index.ts) 以只读方式打开持久化会话，并在聚合后关闭每个句柄。[计数函数](src/aggregate.ts) 对每次尝试只结算一次，保留重试报告的用量，并单独统计缺少用量的尝试。Token 数包含输入、输出、缓存读取和缓存写入。最长会话时长取各会话已完成轮次时长之和的最大值，排除空闲间隔和未完成轮次。

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

- 总量只覆盖保留的本地历史，不代表供应商账单。缺失的用量不计入总量，并通过 `missingUsageAttempts` 报告；持久化服务不可用时读取失败。崩溃中断的轮次不计入活动时长，因为其结束时间戳包含离线时间。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
