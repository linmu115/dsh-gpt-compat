---
{
  "id": "IMP-current",
  "kind": "implementation",
  "title": "副本接入与Maintenance 扩展数据 Adapter",
  "status": "current",
  "summary": "0.5.0-dev.3 已完成副本真实调用，推理强度配置已补齐；Maintenance 独立适配器源码完成。",
  "progress": "in_progress",
  "sources": [
    {
      "path": "../../src/responses.ts"
    },
    {
      "path": "../qualification.md"
    },
    {
      "path": "../maintenance.md"
    }
  ]
}
---

# 副本接入与Maintenance 扩展数据 Adapter

开发包 0.5.0-dev.3。需要基于 3a7508d20 的宿主补丁；独立 0.1.5-rc.2 副本已安装，主实例未切换。此前真实 CPA 已验证原生压缩与跨进程接续；副本进一步完成 apply_patch、exec_command、write_stdin 真实调用，4 个模型步骤完成。证据汇总见 docs/qualification.md。

每个会话按提供商与模型绑定路由；原生 Responses 重放与双检查点持久化保留原始历史。nativeContextMode=codex-v2 使用 compaction_trigger 与标注的本地估计。推理强度从每个模型的 reasoningEfforts/defaultReasoningEffort 声明，不再因适配器未声明能力而失去选择。

0.5.0-dev.2 修复经典脚本 ModuleLoader 注册，dev.3 补齐模型推理配置。当前源码 60 项离线测试通过，1 项可选 live 测试跳过，类型检查通过；真实账号结果属于之前明确记录的验收。

Maintenance 之前用全局依赖替换重新打包以完成联调；现已构建gpt-compat 扩展数据 Adapter，按插件所有权处理事件，见 [[INT-maintenance]]。扩展数据 Adapter 已在副本运行：Maintenance Engine rc2.30 / 插件 rc2.24，宿主 dsh-0.1.5，GPT 面板包含 1 个会话索引。原验收事件前缀和其它插件文件保持一致。

尚待：正常大容量长任务、压缩辅助调用用量汇总、全新机器安装和 Harbor / Inspect AI 对照评估。SSE 仍缓冲终态；进程句柄不跨重启恢复；不声称性能、智力、时间或成本收益。

设置页样式已按用户 2026-09-17 的截图反馈统一到 DSH 模型设置页：复用平台 ui-primitives 的按钮、输入框与图标，使用宿主语义主题颜色、16px 卡片圆角和表单间距，模型列表改为可换行文本框。样式由插件生命周期注册和卸载；修改、保存、冲突保留草稿及放弃修改的语义不变。验证与副本前端热更新范围见 [设置页验证](../../../settings-ui.md)。

可选 CPA 账号模块 0.1.0 已实现并安装到副本：多账号保存、指定单个代理、失败不轮换、额度查询和新增/移除登录。CPA 固定选择扩展与本机管理密码文件入口已部署，原管理密码未改动；正式重新核验实例接入后启动成功，面板已连接 2 个账号并获取额度，保留 51 个会话。说明与验收见 [[MOD-accounts]]、[[VER-accounts]]。

2026-09-17 设置入口调整：独立注册设置左侧“GPT 适配”栏目，模型页不再挂载兼容表单。当前副本移除旧 dsh-codex-runtime 的 bundle、直接依赖及运行配置，随之撤回“Codex”栏目；会话、账号和主实例保留。新安装需重新验证 Maintenance 接入清单，具体交付见 [设置页记录](../../../settings-ui.md)。

独立栏目已在副本完成页面验收：2 个账号正常显示，50 个已有内容会话 ID 保留，空白入口重建后仍为 51 项。旧 Runtime bundle 附带的共享 `dsh-runtime-support` 改为独立注册，继续服务团队协作与会话分发；没有重新启用嵌入式 Codex。
