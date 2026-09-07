# Agent Note: 安装独立自定义插件依赖

Status: implemented

[English](2026-09-07-standalone-custom-plugin-install.md) | 中文

## 问题

根 pnpm 工作区不包含独立的自定义插件。因此，工作区安装与构建成功不能证明这些插件的运行时导入可解析；personal-assistant 缺少 MCP SDK 依赖会阻止应用启动。

## 决策

[自定义插件安装器](../../../../scripts/install-custom-plugins.mjs) 使用 `--ignore-workspace --frozen-lockfile` 和 `CI=true`，安装 `Custom Plugins` 下每个包含包清单的直接子目录。每个包声明其入口并提交自己的锁文件。安装后，一个新的 Node.js 进程导入该入口；任何安装或导入失败都会终止命令。Windows 启动器在构建前运行此命令，静态 CI 任务也运行相同检查。

## 考虑过的替代方案

**依赖工作区安装。** 它不覆盖这些独立包，无法检测其中缺失的运行时依赖。

**仅使用 mock 导入测试。** mock MCP 客户端可以验证插件行为，却掩盖缺失的 SDK 依赖。导入实际入口可以在不激活配置档的情况下验证依赖解析。

## 影响

启动准备包含自定义插件各自的依赖安装与原生导入。冻结锁文件会拒绝未记录的依赖变更。安装器准备检出目录中的包，不重置现有配置档的会话或设置；仅导入成功不能验证插件激活或外部服务。
