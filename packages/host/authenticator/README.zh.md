---
description: "本地身份验证器账户存储、经过身份验证的管理操作，以及面向会话和 MCP 客户端的 TOTP 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-authenticator

[English](README.md) | 中文

## 概述

本参考文档说明本地六位 TOTP 账户。插件在 Web 配置中挂载，为“设置 → 插件 → 插件配置”中的 Authenticator MCP 卡片提供账户操作。

## 目录

- [配置与存储](#configuration-and-storage)
- [经过身份验证的操作](#authenticated-operations)
- [运行时不变量](#runtime-invariants)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration-and-storage"></a>
## 配置与存储

`path` 指定专用账户文件。省略时使用 `<dshHome>/authenticator/accounts.json`，`dshHome` 默认遵循 `DSH_HOME` 和 `~/.dsh`。Windows 目录通过显式 ACL 限制为当前账户访问；POSIX 目录以 0700 模式创建。原子文件替换使用 0600 模式，修改操作使用跨进程写锁。现有数据无效时操作失败，不替换原文件。配置密钥仅存储在本地文件中，不进入设置文档或 API 响应。

导入支持标准 `otpauth://totp/` URI，要求六位数字、SHA1/SHA256/SHA512，以及不超过 3600 秒的正数周期。重复密钥或发行者与标签组合会被拒绝。删除会从已提交的文档中移除账户，但不保证清除备份或文件系统历史中的数据。

<a id="authenticated-operations"></a>
## 经过身份验证的操作

现有 Connection cookie 和来源检查保护所有路由。`GET /authenticator` 返回账户标识、标签、发行者、周期、当前验证码，以及 Unix 毫秒表示的 `validUntil`。`POST /authenticator/import` 接受 `{uri}` 并返回账户元数据。`POST /authenticator/delete` 接受 `{id}` 并返回 `{removed}`。响应禁止缓存，错误信息不会回显配置输入。

`POST /authenticator/mcp` 通过官方 SDK 实现无状态 MCP Streamable HTTP。客户端必须提供应用的身份验证 cookie 和受接受的来源及主机；此端点不提供独立 bearer token 或公共服务器。账户发现和验证码读取与设置共享同一存储。导入和删除属于管理界面操作。

<a id="runtime-invariants"></a>
## 运行时不变量

不发布不变量伴随模块：账户视图和验证码直接从持久文档计算，不存在可能产生不一致的独立缓存。

<a id="model-experience"></a>
## 模型体验

### 组合身份验证器插件后的会话工具

#### 模型看到的内容

`authenticator_list_accounts` 返回账户标识和标签，不含配置密钥。`authenticator_get_code` 返回当前六位验证码及到期时间。会话请求的验证码作为普通工具结果进入会话日志和模型上下文。每个已组合的会话都可请求所有导入账户；导入账户即授予该访问权限。

#### Token 影响

两个工具定义产生固定提示成本。账户发现输出随账户数量增长；验证码读取只返回一个账户。插件不增加系统提示章节，也不发起后台模型请求。

#### KV 缓存影响

账户变化不会改变工具定义。请求的验证码进入工具结果历史；验证码更新不会修改先前消息或提示前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 不支持 HOTP、非六位验证码和多账户迁移导出。验证码有效性依赖本地时钟。
- 存储是受权限保护的明文，不是加密数据；同一操作系统用户运行的进程可以读取。
- 外部 MCP 客户端需要提供现有浏览器 cookie。尚未实现按会话授权账户或独立 MCP 身份验证流程。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

存储和身份验证决策记录在[本地身份验证器 Agent Note](../../../.agents/notes/implemented/architecture/2026-09-07-local-authenticator-mcp.zh.md) 中。

</details>
