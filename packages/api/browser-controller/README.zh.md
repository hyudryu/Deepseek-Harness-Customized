---
description: "通过 Remote API 打开或关闭会话浏览器，并传输实时浏览器快照。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-browser-controller

[English](README.md) | 中文

## 概述

此控制器允许 Web 客户端打开会话浏览器、导航页面并跟踪页面画面和操作历史。浏览器操作使用 browser-control 插件拥有的同一个会话浏览器。会话标识符在服务调用之间保留带品牌标记的 `SessionId` 类型。关闭确认表示浏览器上下文已完成关闭；清理失败会拒绝请求，并保留任何仍然打开的上下文以供重试。初始导航失败会拒绝请求，同时发布仍然打开的浏览器状态，以便客户端将其关闭。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 应用组合同时挂载此控制器和 `ctx.browserControl` 提供方。[浏览器面板](../../client/ui-browser/README.zh.md) 使用其生成的 `remote.browser` API。控制器没有配置字段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[控制器](src/index.ts) 先订阅再读取初始快照，因此流启动期间到达的画面仍然可用。取消会移除订阅。browser-control 提供方拥有 Playwright 上下文和截图；控制器转发其操作和快照。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无；本包展示浏览器状态并提供控制，不向模型请求添加内容。

#### KV Cache 影响

无；本包不组装或发送提供方请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 浏览器状态是实时进程状态，不属于持久化会话回放。
- 控制器需要 browser-control 提供方，不会启动独立的浏览器实现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包转发浏览器状态，不维护第二份权威数据；生命周期行为由专项测试验证。
