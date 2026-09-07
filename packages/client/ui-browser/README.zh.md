---
description: "从右上角工具栏打开会话浏览器，并查看页面画面和操作历史。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser

[English](README.md) | 中文

## 概述

右上角浏览器图标启动所选会话的浏览器并展开右侧面板。面板显示页面截图、当前 URL 和浏览器操作历史。导航失败会显示在面板中；隐藏面板不会关闭浏览器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

可选的 `Custom Plugins/browser-control` 包同时挂载提供方、此 UI 和[浏览器控制器](../../api/browser-controller/README.zh.md)。选择会话，点击右上角图标，然后在面板中输入地址进行导航。同一图标可收起面板；面板中的停止浏览器操作会关闭浏览器上下文。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[客户端插件](src/client/index.ts) 注册 [ui-layout](../ui-layout/README.zh.md) 拥有的 `browser.toggle` 和 `browser` 槽位。Remote 修改操作在更新查看状态前检查结果。会话级可观察数据源通过 inject 的 `hooks` 区域提供 Remote 快照。渲染器绑定 `useBrowser`；首次订阅打开流，最后一次取消订阅释放流。两次发布之间的快照引用保持稳定。默认 Web 包不挂载控制器或此 UI。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无；本包展示浏览器状态并提供控制，不向模型请求添加内容。

#### KV Cache 影响

无；本包不组装或发送提供方请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 页面画面是截图视图；在其上移动指针不会向浏览器发送点击或键盘输入。
- 面板几何状态是临时的，不会在重新加载后保留。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包转发浏览器状态，不维护第二份权威数据；生命周期行为由专项测试验证。
