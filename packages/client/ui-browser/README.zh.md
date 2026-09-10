---
description: "从右上角工具栏打开会话浏览器，并查看页面画面和操作历史。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser

[English](README.md) | 中文

## 概述

右上角浏览器图标启动所选会话的浏览器并展开右侧面板。面板显示页面截图、当前 URL 和浏览器操作历史。导航失败会显示在面板中；隐藏面板不会关闭浏览器。浏览器打开时（包括由智能体的 `browser` 工具启动）面板会自动展开；页面视图可交互，点击、拖拽、滚轮和键盘输入都会转发给当前标签页。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

可选的 `Custom Plugins/browser-control` 包同时挂载提供方、此 UI 和[浏览器控制器](../../api/browser-controller/README.zh.md)。选择会话，点击右上角图标，然后在面板中输入地址进行导航。同一图标可收起面板；面板中的停止浏览器操作会关闭浏览器上下文。浏览器打开时面板自动展开，收起面板不会关闭浏览器。页面视图可交互：在画面上点击、拖拽、滚动和输入会按页面 CSS 像素作为指针、滚轮和键盘输入转发给当前标签页，因此登录等操作可直接在面板中完成，无需另开窗口。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[客户端插件](src/client/index.ts) 注册 [ui-layout](../ui-layout/README.zh.md) 拥有的 `browser.toggle` 和 `browser` 槽位。Remote 修改操作在更新查看状态前检查结果。[不依赖 React 的可观察对象](src/client/browser-state.ts) 管理每个 Session 流，渲染器将它绑定到面板注入的 `useBrowser` hook。最后一个订阅方退出时释放流和缓存帧，插件释放时等待所有清理完成。面板只保留查看状态：它把 agent 光标定位到等比容纳的图像内（含留黑偏移），并用同一映射反向换算输入的页面像素。转发的指针移动会被节流；由于 React 以被动方式注册 wheel，滚轮事件由面板自己的非被动监听器处理。两次发布之间的快照引用保持稳定。默认 Web 包不挂载控制器或此 UI。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无；本包展示浏览器状态并提供控制，不向模型请求添加内容。

#### KV Cache 影响

无；本包不组装或发送提供方请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 画面是周期性截图：转发的点击或按键会立即到达页面，而可见结果要等到下一帧画面。
- 剪贴板粘贴、文件拖放以及桌面占用的组合键（例如 `Meta+Tab`）不会被转发。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包转发浏览器状态，不维护第二份权威数据；生命周期行为由专项测试验证。
