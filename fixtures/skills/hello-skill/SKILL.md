---
id: hello-skill
name: Hello Skill
description_zh: 演示技能：运行 main 脚本，返回问候结果，用于验证 Skill 执行链路
description_en: Demo skill: run the main script to get a greeting, used to verify the skill execution pipeline
---

# Hello Skill

用于验证 Skill 系统的最小演示技能，包含 `scripts/main.mjs`（ESM）与 `scripts/main.py`（Python）两种脚本形态。

## 运行脚本

调用约定为平台无关形式（`<APP_DIR>` 是项目根绝对路径，由当前 OS 决定拼写方式）：

```text
node <APP_DIR>/bin/run-skill.cjs hello-skill main
```

> 注意：Windows 下按 `node "D:\...\bin\run-skill.cjs" hello-skill main` 拼写；
> 不要使用 bash 专属的 `"$VAR"` 语法（本机为 PowerShell / cmd 环境）。

## 脚本说明

- `main.mjs`：ESM 入口，返回 `{ ok: true, hello: "world" }`，由 run-skill JSON 序列化到 stdout。
- `main.py`：Python 入口，直接打印 `{"ok": true, "hello": "python"}` 到 stdout。
