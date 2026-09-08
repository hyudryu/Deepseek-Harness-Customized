---
description: "通过本地桌面控制经身份验证的 Tailscale Web 应用访问。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-mobile-access

[English](README.md) | 中文

## 概述

此插件允许经过身份验证的桌面用户通过 Tailscale 启用移动访问。它在计算机的 Tailscale IPv4 地址上使用桌面端口提供现有应用，共享会话、设置、路由和浏览器身份验证。

公布的主机地址遵循 URL 规范化规则，省略 HTTP 默认端口 80。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

Web 包将此插件与[移动访问控件](../../client/ui-mobile-access/README.zh.md)组合。将计算机和手机连接到同一 tailnet，并确保访问策略允许应用端口。在桌面打开设置旁的手机图标，启用访问并扫描二维码。二维码包含身份验证应用 URL；打开后建立手机浏览器会话。

每次应用启动时访问均关闭。关闭访问会关闭 Tailscale 监听器及其 HTTP 和升级连接，同时保留桌面监听器。关闭对话框不改变监听器状态。不会复制、重置或迁移会话或设置。

桌面监听器必须绑定回环地址。地址发现使用活动的 Tailscale 命名接口，或官方 CLI 返回且已分配到本机的 IPv4 地址。`tailscaleExecutable` 配置可执行文件；`discoveryTimeoutMs` 限制 CLI 发现时间。缺少 Tailscale、地址无效或绑定失败时，访问保持关闭，并向控件报告失败。

<a id="understand-the-implementation"></a>
## 了解实现

仅限桌面的 `/mobile-access` 端点接受经过身份验证的 GET 状态读取和 POST 布尔值更新。更新按顺序执行，成功响应描述已生效的监听器状态。附加监听器共享 [Web 服务器](../webserver/README.zh.md)分发器，在分发前检查精确的 Tailscale Host 和同源浏览器标头，并要求资源、API 和升级请求通过[浏览器身份验证](../../client/connection/README.zh.md)；只有根路径令牌交换在 cookie 身份验证前执行。主机授权仅适用于从该接口收到的请求，并在关闭或卸载插件时撤销。

<a id="further-exploration"></a>
## 进一步阅读

- [移动访问决策](../../../.agents/notes/implemented/feature/2026-09-07-tailscale-mobile-access.zh.md)
- [Web 服务器子系统](../../../docs/subsystems/web-server.zh.md)

<a id="model-experience"></a>
## 模型体验

无，因为此插件提供现有浏览器应用的访问，不添加模型可见内容或工具。

#### KV Cache 影响

无；监听器状态不会改变模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 访问在 Tailscale 加密网络内使用 IPv4 和 HTTP。插件不配置 Tailscale、HTTPS 证书、公网转发或网络访问策略。启动 URL 授予现有应用的访问权限，不创建受限移动账户。需要安全上下文的浏览器 API 受 HTTP 限制约束。重启应用后，需要桌面重新启用访问，并使用新的启动 URL 首次配对。


<a id="dev-note"></a>
### 开发备注

不发布运行时不变量配套模块：监听器状态和清理函数由同一个所有者管理，不存在独立观测。真实 Loader 组合测试通过 HTTP 和升级套接字验证身份验证、关闭、激活失败和资源清理。
