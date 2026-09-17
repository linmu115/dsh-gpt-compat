---
{
  "id": "IMP-current",
  "kind": "implementation",
  "title": "当前实现：自动模型目录与副本接入",
  "status": "current",
  "summary": "GPT 设置区自动展示可用模型，选择留在会话页；账号管理、原生工具与压缩、Maintenance 扩展已接入 rc.2 副本，长任务和成本评估待完成。",
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
    },
    {
      "path": "../settings-ui.md"
    },
    {
      "path": "../responses.md"
    }
  ],
  "gap": "大容量长任务、压缩调用用量汇总、全新机器安装与 Harbor / Inspect AI 对照评估仍待完成。"
}
---

# 当前实现：自动模型目录与副本接入

开发包 0.5.0-dev.3，模型目录实现提交为 `b84e17b`。当前接入独立的 0.1.5-rc.2 副本，主实例未切换；宿主扩展仍基于 3a7508d20 补丁。这里说明当前行为，验证结果按模块单独查阅。

## 模型与设置

设置窗口左侧“GPT 适配”提供只读模型列表、刷新和 CPA 账号管理。无需填写提供商、型号或兼容绑定；真正的模型与推理强度选择在会话页面。页面复用 DSH 组件和主题，原模型设置页不再重复挂载插件表单。

同端点 CPA 账号模块已连接且原生路线采用 `codex-v2` 时，模型目录由账号支持列表与 CPA 能力资料共同生成。固定模式读取指定账号，暂停模式返回空目录；上下文容量和推理档位随实际型号读取，图片生成型号不混入会话模型。缺失容量或发现失败会明确报错。未接入该发现服务的普通 Responses 路线沿用显式配置，详见 [Responses 接入说明](../../../responses.md)。

兼容工具与上下文都使用本插件提供商的自动 GPT 范围；其它提供商仍按高级显式绑定匹配，不因型号同名自动接管。会话独立生效，当前请求保留准备时的配置与模型能力，切换在下一安全步骤执行。合同见 [[IF-profile]]；本次目录、界面和安装证据见 [[VER-model-catalog]]。

## 工具、历史与账号

兼容路线提供 apply_patch、exec_command、write_stdin，并继续使用 DSH 文件、权限与任务服务。原生 Responses 重放保留响应身份、专用输出项和加密状态；完整原始历史与双检查点持久化支持两条路线独立压缩和切换接续。`codex-v2` 使用 compaction_trigger 与有明确边界的本地预算估计。真实调用与压缩证据见 [[VER-cpa]]、[[VER-codex-v2]]，汇总见 [联调说明](../../../qualification.md)。

可选 CPA 账号模块 0.1.0 支持多个登录账号、指定一个代理账号、额度查询和新增/移除登录。选号对该 CPA 生效；失败不自动换号。OAuth 凭据由 CPA 保管，管理密钥留在 DSH 凭据服务。账号职责和独立验证见 [[MOD-accounts]]、[[VER-accounts]]。

## 副本与会话维护

当前副本已移除旧 dsh-codex-runtime 的 bundle、依赖与运行配置，“Codex”设置栏目随之撤回。团队协作和会话分发仍依赖的 `dsh-runtime-support` 独立注册，保留已有会话和登录数据。

Maintenance 使用宿主 `dsh-0.1.5` 与独立 `gpt-compat` 扩展数据 Adapter；GPT 插件数据放在扩展数据栏目，不注册为 Harness Adapter。副本使用 Engine rc2.30 / 插件 rc2.24；改变安装清单或受绑定文件时通过正式接入校验恢复启动。接入边界见 [[INT-maintenance]] 和 [维护说明](../../../maintenance.md)。

## 剩余范围

正常大容量长任务、压缩辅助调用用量汇总、全新机器安装和 Harbor / Inspect AI 对照评估仍待完成。SSE 当前缓冲到终态，进程句柄不跨重启恢复；没有性能、智力、时间或成本收益结论。模型目录显示可用不等同于逐型号完成真实生成测试。

此前手填表单与独立栏目修订的定位保留在 [设置页说明](../../../settings-ui.md) 及 Git 历史；当前行为以上述自动目录为准。
