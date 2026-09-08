---
description: "冻结的已发布 v2 Session 读取器，以及把精确的 v2 产物重新发布为 v3 的恒等迁移，使持久的 skill-catalog 源可以携带可选的展示摘要。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-format-v2-to-v3

[English](README.md) | 中文

## 概述

`dsh-session-format-v2-to-v3` 把完整的已发布 v2 Session 重新发布为已发布 v3，且不改变其事件模型。写入方版本提升是必需的，因为已发布 v3 允许持久的 `skill-catalog` 消息源携带可选的 `presentationDigest` 标识，而冻结的 v2 源校验器会把它当作未知成员拒绝。该迁移校验精确的 v2 源，把逻辑与物理 header 标记为 v3，保持每个事件与引用不变，并校验精确的 v3 目标。`releasedV3SessionFormatCodec` 随后编码或解码当前物理表示。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时使用

持久化通过 `dsh-session-format-catalog` 获取该迁移边；功能组合不会挂载它。只有在装配或测试静态已发布格式目录，或检查精确的 v2 到 v3 重新发布时，才直接导入本包。它不发布运行时不变式伴生入口，因为每次 codec 与迁移调用都会校验完整的源或目标 artifact，且不保留运行时状态。

### 入口

```text
const decodedV2 = releasedV2SessionFormatCodec.decodeArtifact(header, rows)
const migratedV3 = sessionFormatV2ToV3.migrate(decodedV2)
```

`releasedV2SessionFormatCodec` 读取冻结的 v2 物理语言。`sessionFormatV2ToV3` 校验完整源产物、把它重新发布为 v3，并校验精确的 v3 结果。`releasedV3SessionFormatCodec` 随后编码或解码当前物理表示。

v3 源语义与 v2 清单一致，只是持久的 `skill-catalog` 源在 `kind`、`form`、`entries` 之外允许可选的 `presentationDigest` 字符串。v0、v1、v2 校验器继续拒绝该成员。v3 物理 header、每行一个事件的编码、provenance 范围与可恢复前缀解码均与 v2 一致。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该迁移边校验精确的 released-v2 产物，复用冻结的 v2 事件清单，并返回把 header 版本改为 3 的恒等产物。随后它校验精确的 released-v3 产物，其 payload 语义复用共享生成器，并对 `skill-catalog` 源使用 v3 版本门控。

| 文件 | 职责 |
|---|---|
| [`src/migration.ts`](src/migration.ts) | Released-v2 源校验及到 v3 的恒等重新发布 |
| [`src/codec.ts`](src/codec.ts) | 已发布 v3 header、每行一个事件的编码、provenance 范围与可恢复前缀解码 |
| [`src/validation.ts`](src/validation.ts) | v3 物理 envelope／cut 校验、精确 migration-target 策略与 vocabulary-neutral current restoration |
| [`src/dispositions.ts`](src/dispositions.ts) | 冻结的已发布 v3 事件与 payload 成员清单 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [已发布 v1 到 v2 迁移边](../session-format-v1-to-v2/README.zh.md)——本包复用的源编解码器与冻结词表。
- [静态目录](../session-format-catalog/README.zh.md)——构建拥有的编解码器与迁移顺序。
- [Session 持久化子系统](../../../docs/subsystems/persistence.zh.md)——不可变 generation 选择与发布。

-----

<a id="model-experience"></a>
## 模型体验

### 历史还原

#### 模型看到什么

还原后的 v3 Session 呈现与 v2 源完全相同的派生消息历史。`presentationDigest` 是面向非模型消费者的持久目录标识，不会进入 `deriveMessages()`。

#### Token 影响

迁移不会添加模型可见内容，并精确保留派生消息历史。

#### KV Cache 影响

还原后的模型 message 序列保持不变，因此迁移本身不会改变请求前缀的缓存身份。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **封闭的第一方源清单**——未知 v2 事件会使迁移失败，包括带有 `ignorable: true` 的事件。
- **全产物转换**——该迁移边会在内存中物化源与目标；它不会流式重新发布。
- **不负责发布或兼容回退**——持久化拥有排他 successor 发布，保留的 v2 generation 不是自动 downgrade 或 restore 输入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
