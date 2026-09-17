---
{
  "id": "EXP-client-service-injection",
  "kind": "experience",
  "task_id": "HIST-model-discovery",
  "title": "构建通过不能证明宿主服务注入正确",
  "date": "2026-09-17",
  "status": "current",
  "categories": [
    "debugging",
    "verification"
  ],
  "results": [
    "failed",
    "passed"
  ],
  "modules": [
    "GPT 设置页",
    "宿主加载"
  ],
  "summary": "首次页面加载遗漏 remote 根服务依赖，离线构建未覆盖 Cordis 的运行时访问检查。",
  "outcome": "补齐根服务和命名服务，重新安装后页面加载通过。",
  "applicability": "DSH GPT 兼容插件 0.5.0-dev.3、rc.2 副本；来自模型目录改造任务。",
  "coverage_note": "Codex 于 2026-09-17 根据所属任务的公开用户消息、源码操作和工具反馈整理。经验边界以当时实现为准。",
  "related_records": [
    "IMP-current",
    "VER-model-catalog"
  ]
}
---

# 构建通过不能证明宿主服务注入正确

客户端调用 `ctx.remote.session.modelCatalog()` 时只声明了 `remote.session`。构建可生成脚本，但真实副本加载插件时拒绝访问未声明的 `remote` 根服务。

[查看依据：真实加载错误和对应检查调用](history-event:EVT-5bbba2e972c9cbbc763c)

修复将两项依赖同时声明，重新完成类型检查、构建与 14 项相关测试，再通过正式安装和 Maintenance 校验启动副本。

[查看依据：修复后的构建和相关测试](history-event:EVT-afab5ebeb6ddd90bb5b4)

[查看依据：真实设置页无错误、会话与绑定材料保留](history-event:EVT-8d2cbf727f5b888833b7)

这个案例说明依赖 Cordis 运行时服务的客户端变更，需要实际经过宿主 Loader 验证。测试覆盖什么就声明什么；不把构建成功等同于插件成功加载，也不把该规则泛化成所有无关文案修改都必须重装。
