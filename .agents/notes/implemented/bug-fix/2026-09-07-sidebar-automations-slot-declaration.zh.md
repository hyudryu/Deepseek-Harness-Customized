# Agent Note: 声明侧边栏自动化 slot

Status: implemented

[English](2026-09-07-sidebar-automations-slot-declaration.md) | 中文

## 问题

侧边栏组件渲染一个可选的自动化 slot，但缺失的子 slot 声明导致客户端 TypeScript 构建失败，也使插件缺少可占用的运行时声明。

## 决策

[侧边栏注册](../../../../packages/client/ui-sidebar/src/client/index.ts) 将 `sidebar.automations` 声明为根作用域的 single slot。外壳在 Workspace 浏览器上方渲染它，并在展开与轨道状态下都传入 `wide`。功能插件拥有其中的内容。

## 考虑过的替代方案

**删除渲染调用与 slot 类型。** 这会移除预期的插件扩展点。声明已有 slot 可以保留该扩展点，同时满足类型化注册 API。

## 影响

外壳向组件与运行时注册表提供相同的子 slot。部署可以让它保持为空；侧边栏不拥有任何自动化状态。
