---
description: "在插件配置中导入验证器二维码并管理当前 TOTP 验证码。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-authenticator

[English](README.md) | 中文

## 概述

设置 → 插件 → 插件配置中的 Authenticator MCP 卡片可从二维码图片导入 TOTP 账户，显示当前六位验证码，并在确认后删除已存储的账户。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

展开 Authenticator MCP 卡片，选择导入二维码，然后选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。图片在浏览器中解码；只有 TOTP 配置 URI 会发送到经过身份验证的[验证器主机](../../host/authenticator/README.zh.md)。每个账户显示标签、签发者、当前验证码及剩余有效时间。删除操作需要确认。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[客户端插件](src/client/index.ts) 向 `settings.plugin.item` 注册键为 `authenticator` 的卡片。卡片展开时通过经过身份验证的请求读取账户。主机负责账户持久化和验证码生成；导入后浏览器不保留配置图片或密钥。

插槽注册方注入读取、导入和删除账户的回调，并验证经过身份验证的响应。展示组件管理展开状态、轮询和状态消息，不调用浏览器传输。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无；此包显示账户状态和控件，不向模型请求添加内容。

#### KV 缓存影响

无；此包不组装或发送提供商请求。

## 已知限制与待办事项
<a id="known-limitations-and-deferred-work"></a>

- 导入接受普通 `otpauth://totp/` 二维码；不支持 HOTP 或验证器专有的批量导出格式。
- 账户操作需要连接到正在运行的 Harness 服务器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**Runtime invariant:** 不发布配套不变量插件。主机负责账户数据和验证码生成；此包显示经过身份验证的响应。
