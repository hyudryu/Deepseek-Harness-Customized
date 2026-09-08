---
description: "在第五个设置标签页中查看 token 历史、连续活动天数和模型用量。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

[English](README.md) | 中文

## 概述

用量功能在标准组合中添加第五个设置标签页。它显示总 token 数、每日峰值 token 数、最长会话活动时长，以及当前和最长连续活动天数。日历热力图支持每日、每周和累计视图；token 趋势和模型占比使用所选的七天或三十天范围。

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

浏览器插件贡献顺序为 40 的 `settings.section` 条目，并读取[用量控制器](../../api/usage-controller/README.zh.md)。图表数据从 UTC 每日记录派生。可展开的活动数据区域显示所选热力图模式的精确总量，月份标签标记 UTC 月份切换。模型颜色在不同日期范围间保持稳定；趋势虚线和图例样式使序列区分不只依赖颜色。类型化语言词典拥有可见标签，现有设置外壳拥有导航。

**运行时不变量：** 不发布配套模块，因为图表和指标从同一个查询响应派生，没有独立维护的计数状态。

</details>

-----

<a id="model-experience"></a>
## Model Experience

None，因为此包只向用户显示用量，不注册提示词、工具或会话事件。

#### KV Cache effect

没有直接影响；读取用量不改变模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 统计数据描述保留的本地会话和已报告的 token。此页面不估算账单费用或账户套餐配额。热力图覆盖截至今天的 364 个 UTC 日期；每周区间包含七个显示日期，累计值只覆盖该显示期间。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
