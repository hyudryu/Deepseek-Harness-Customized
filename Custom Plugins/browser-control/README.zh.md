# 浏览器控制

[English](README.md) | 中文

此可选扩展包让会话的浏览器工具与面板共享浏览器。默认后端是 Chrome：连接 `http://127.0.0.1:9222`，仅在端口不可用时使用独立持久配置启动可见的已安装 Chrome。Playwright 客户端提供 CDP 传输和语义定位器；Chrome 模式不会启动隔离浏览器。连接失败不会回退到 Playwright。

通过 `install:custom-plugins` 安装依赖，再将此扩展包或别名 `dsh-chrome-browser` 添加到配置。两者使用相同的提供方、控制器和面板 ID；配置中只安装一个。`backend: playwright` 显式选择隔离的 Playwright Chromium 上下文；只有用户明确要求时，工具才在 `open` 中指定此后端。切换后端会先关闭该会话原有标签页。

`homepage` 默认为 `https://www.google.com/`。不提供 URL 时，新会话打开主页；已有会话保留当前位置。`jackandjill.com` 等裸域名使用 HTTPS，回环地址使用 HTTP；显式 HTTP 和 HTTPS 地址保持不变。本地测试可使用 `about:blank`。无效地址在分配浏览器资源前被拒绝。

`chromeEndpoint` 必须是带显式端口的 HTTP 回环源。`chromeUserDataDir` 默认为 `~/.dsh/chrome-profile`；`chromeExecutablePath` 可指定已安装 Chrome 可执行文件的绝对路径。`chromeConnectTimeoutMs` 默认为 `10000`。`headless` 仅适用于 Playwright。Chrome 凭据与 Cookie 持久保存。关闭会话或卸载插件不会关闭原有标签页、共享上下文或 Chrome；只关闭会话创建的标签页及其弹出窗口。

面板和工具可以创建、选择和关闭本会话标签页。工具操作 `tabs`、`new_tab`、`switch_tab` 和 `close_tab` 使用 `tabs` 返回的不透明 `tab_id`。关闭其他标签页不会改变 ID；其他会话的 ID 会被拒绝。关闭最后一个标签页会停止会话浏览器。旧操作 `pages` 与 `switch_page` 保留位置索引。序列化标签页结果超过 `maxSnapshotChars` 时，会在交付模型前被拒绝。

`frameQuality` 控制 JPEG 画面，默认为 `60`，接受 `0` 到 `100` 的整数。配置无效时加载失败。CDP 浏览器没有模拟视口时，截图采用可见视口尺寸。

首次导航失败会等待新建资源清理完成后再拒绝请求；已有上下文在导航失败后仍保留。会话生命周期操作按调用顺序执行。清理失败允许重试。卸载插件会等待拥有的资源清理完成，并断开 Chrome 连接，保留其进程。

运行 `node --test "Custom Plugins/browser-control/test/*.test.mjs"`。测试覆盖 URL 与配置验证、生命周期并发、隔离 Playwright 行为、Chrome 标签页归属及卸载后原有标签页的保留。Chrome 测试使用临时配置和临时端口，并关闭自己启动的进程。真实提供方测试需要已安装的 Chrome 与 Playwright Chromium。
