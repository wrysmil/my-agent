# My Agent

LLM Agent 运行时框架 - 从零搭建学习项目。

## 项目结构

```
my-agent/
├── docs/
│   ├── plan/
│   │   └── 第一阶段实现指南.md    # 分模块实现指南
│   └── spec/
│       └── 仿写Agent框架指南.md     # 框架设计规范
├── src/                            # (待实现) 源码目录
│   ├── shared/                     # 错误、类型、日志（零依赖）
│   ├── config/                     # Zod schema 配置
│   ├── tools/                      # 工具抽象层
│   ├── providers/                  # LLM Provider 适配层
│   └── agent/                      # Agent 主循环
└── tests/                          # (待实现) 测试目录
```

## 技术栈

- **TypeScript** + **Node.js** (ESM)
- **Zod** - 运行时配置校验
- **Vitest** - 测试框架
- **tsx** - TypeScript 直接执行

## 开始

```bash
npm install
npm test
```
