# 浏览器控制

[English](README.md) | 中文

此可选 profile bundle 为每个会话的浏览器工具和浏览器面板提供共享的 Playwright Chromium 上下文。将 bundle 添加到 profile 之前，使用仓库的 `install:custom-plugins` 命令安装依赖。

`frameQuality` 控制面板 JPEG 画面的质量。默认值为 `60`，接受从 `0` 到 `100` 的整数（含端点）。无效值会使插件加载失败。

关闭浏览器时，Playwright 关闭失败会报告给调用方，并保留上下文以供重试。成功关闭会移除该会话的浏览器状态。订阅在关闭和重新打开期间保持有效。插件释放会尝试关闭每个上下文，然后关闭共享浏览器，等待关闭完成并报告清理失败。

初始导航失败会先关闭新建的上下文，再拒绝打开请求。导航失败会保留已有的上下文。如果回滚清理也失败，请求会报告两项错误，并保留上下文以便显式重试清理。

在仓库根目录运行 `node --test "Custom Plugins/browser-control/test/browser.test.mjs"` 来执行行为测试。测试包括真实 Chromium 导航、交互、画面捕获、关闭和重开，以及配置和关闭失败回归。必须通过插件的 Playwright CLI 安装 Chromium；CI 会安装它并显式运行此测试套件。
