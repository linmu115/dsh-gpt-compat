---
{
  "id": "VER-cpa",
  "kind": "verification",
  "title": "打包产物与真实 CPA 验证",
  "status": "current",
  "summary": "0.4.0-dev.1：39 项离线测试通过；产物跨进程恢复、真实账号工具与普通重放通过；原生压缩及计数未通过。",
  "relations": [
    {
      "relation": "verifies",
      "to": {
        "record_id": "IMP-current"
      },
      "reason": "区分模拟检查点、真实工具与未通过的原生能力"
    }
  ]
}
---

# 打包产物与真实 CPA 验证

开发版本 `0.4.0-dev.1`，2026-09-17。完整操作与限制见 `docs/qualification.md`。

- 插件严格类型检查、构建通过；39 项普通测试通过，1 项可选 live 单测跳过。另行执行了下述真实账号检查，不能把跳过的单测记为通过。
- tgz 解包后通过实际 Cordis Loader 加载。测试宿主组合有 31 个构建包、6 个既有缓存依赖链接，没有 TypeScript 源码别名；未验证完整产品 profile、Typert/Remote/UI 或全新联网安装。
- 模拟服务：实际临时文件补丁、原生检查点持久化、两个独立 Node 进程间的检查点恢复通过；旧工具不重放，卸载后所有权释放。
- 真实 CPA：用户完成新账号 OAuth 登录后，gpt-5.6-luna Responses、custom apply_patch、custom_tool_call_output 回传均为 200。
- 同一 tgz 在真实 CPA 下关闭自动上下文后，由 agent loop 执行补丁、保存会话；另一个进程恢复历史后模型准确回忆标记，没有新增工具调用，文件时间戳不变。
- 原生 compact 有效请求返回 404；两个模型的最小输入均复现。缺少模型参数返回 400，说明路由存在，但具体转发失配点尚未完全定位。原生计数返回 404，所查源码确实未注册该路由。没有有效真实检查点，因此真实压缩后续轮尚未执行。
- CPA 现有本地 CountTokens 未处理不透明 compaction 状态，不能替代本插件要求的准确计数。自动上下文继续默认关闭。已补齐额度耗尽和能力缺失的诊断。

证据：`artifacts/tests-phase4.json`、`artifacts/cpa-live-authenticated-report.json`、`artifacts/staged-runtime-20260917b/qualification.json`、`artifacts/staged-runtime-20260917b/live-qualification.json`。最终文档重打包后的校验见 `artifacts/package-phase4-check.json`。

没有修改 CPA 源码、替换运行二进制或安装到日常 DSH。此次验证不证明任务成功率、智力、时间或成本获得提升；此类结论仍需要 Harbor / Inspect AI 的对照任务。
