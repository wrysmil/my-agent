---
id: coding
name: coding
description_zh: 非平凡代码变更的工程规范：遵循仓库约定、制定计划、最小化编辑、运行验证。
description_en: Engineering standards for non-trivial code changes: follow repo conventions, plan, minimize edits, verify.
---

# Coding Skill

## 核心原则

1. **先读后写** — 修改任何文件前，先用 `read_file` 完整阅读它
2. **最小化变动** — 只改必要的部分，不要重写整个文件
3. **遵循约定** — 匹配项目现有的代码风格、命名惯例、注释密度
4. **逐文件提交** — 每个文件的修改应能独立通过类型检查

## 变更流程

1. **理解现状** — 用 `grep_files` 和 `read_file` 理清相关代码
2. **制定计划** — 确定要修改哪些文件、哪些行
3. **逐个修改** — 用 `edit_file` 做精确替换，或 `write_file` 写新文件
4. **验证** — 运行项目的 lint / typecheck / test 命令

## 注意事项

- 优先使用 `edit_file`（old_string → new_string）而非重写整个文件
- `old_string` 必须精确匹配（含缩进），且唯一
- 新文件用 `write_file`，不要用 shell 写文件
- 写完后不要重新读取文件来"验证"——Write/Edit 工具报错即表示失败
