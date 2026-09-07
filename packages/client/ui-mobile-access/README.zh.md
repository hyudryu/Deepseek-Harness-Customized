---
description: "设置旁的手机控件以及用于 Tailscale 移动访问的二维码配对。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mobile-access

[English](README.md) | 中文

## 概述

此插件在桌面侧边栏的设置右侧添加手机图标。对话框显示移动访问布尔开关，并在启用后显示二维码及经过身份验证的 Tailscale 应用 URL 链接。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

Web 包将控件与[移动访问主机插件](../../host/mobile-access/README.zh.md)一起挂载。从回环桌面应用打开设置旁的手机图标。启用访问后，用连接到同一 tailnet 的手机扫描二维码。对话框还显示 Tailscale 地址和经过身份验证的链接。请将二维码和链接视为应用凭据。

开关反映主机确认的状态，更新期间不可操作，失败时保留最后确认的值。重新打开对话框会刷新状态。关闭对话框不会禁用访问。对话框说明应用重启后访问默认关闭。

手机使用[移动应用布局](../ui-layout/README.zh.md#use-this-package)：会话占满可用宽度，左上角菜单在需要时打开会话导航。选择会话后直接返回对话。紧凑的间距和文字保留浏览器缩放能力，便于无障碍访问。

<a id="understand-the-implementation"></a>
## 了解实现

仅当远程主机报告浏览器来源为回环地址时，插件才向 `sidebar.settings.action` 提供控件。请求使用现有同源浏览器会话。二维码在浏览器本地编码，不会将 URL 发送到外部二维码服务。英文和中文文案由 `mobileAccess` 语言命名空间管理。对话框适配窄视口，开关和链接不依赖二维码渲染。

<a id="further-exploration"></a>
## 进一步阅读

- [移动访问决策](../../../.agents/notes/implemented/feature/2026-09-07-tailscale-mobile-access.zh.md)
- [侧边栏](../ui-sidebar/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无，因为配对对话框不添加模型可见内容或工具。

#### KV Cache 影响

无；配对和监听器状态不会改变模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 控件仅显示在本地桌面来源上。手机可以使用应用，但不能启用或禁用网络访问。二维码生成失败时，身份验证链接仍可用；主机请求失败需要重新打开对话框或重试开关。网络可达性和浏览器安全上下文限制由主机部署负责。


<a id="dev-note"></a>
### 开发备注

不发布运行时不变量配套模块：语言和插槽注册均可撤销，而主机拥有权威监听器状态。组件测试覆盖确认状态、请求错误、二维码错误和对话框生命周期。
