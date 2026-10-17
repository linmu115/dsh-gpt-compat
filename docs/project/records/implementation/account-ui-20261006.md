---
id: IMP-account-ui-20261006
kind: implementation
title: 账号认证失效提示与诊断区排版修复
status: current
progress: complete
summary: GPT.2/Accounts.4已安装，账号认证失效提示及1280/640实际排版验收通过；固定账号、配置与原生历史保持，账号仍待用户重新登录。
relations:
  - relation: implements
    to: {record_id: MOD-accounts}
    reason: 区分账号认证失效与管理密钥错误
  - relation: references
    to: {record_id: IMP-upgrade-20261003}
    reason: 修正上一阶段诊断卡的排版遗漏
---

# 账号状态与诊断样式（2026-10-06）

用户反馈 llm 账号不可用及诊断卡样式异常。主任务核验准确 i0502 / web-i0502 后，发现 CPA 运行且协议读取通过，但第二个待用账号为 error / unauthorized。真实只读额度查询返回 HTTP 401 / token_expired；固定账号未变，无模型生成请求。结果只证明该次认证失败，额度保持未知。

原账号桥接丢弃具体原因，仅显示“暂不可用”。新版增加可选、白名单化 unavailableReason；仅在 unavailable=true、status=error 且有界精确认证代码匹配时返回 authentication。原始错误和凭据不出服务端。额度请求内层 401 映射账号登录失效；管理接口外层 401/403 仍提示管理密钥错误，内层 403/429/500 保持通用额度未知。旧响应和未知原因兼容。

原诊断样式已加载，实测 dt/dd/summary 为默认 16px / normal，而标题为 14px / 22px。新版限定在诊断 section，正文 13px / 20px、标题 14px / 22px，使用标签和值两列及 420px 以下单列；模型详情、段落间距和焦点使用主题规则。

实施遵循本工作区先清单、接口对比、规划再由 Astra 执行的顺序，根任务统一真实实例操作。完整回归 212 passed / 1 skipped，另 6 项 qualifier、类型检查和发行构建通过。候选 GPT `0.6.0-dsh02.2` / Accounts `0.1.4-dsh02.4`，宿主未重建。原未提交内容及运行配置/状态有逐文件校验备份。

两包已通过正式 Launcher 停止、离线安装与正式启动部署，13 包身份/资源验证通过。实际1280px窗口两列、640px窗口单列，字体、行距、详情展开和无横溢检查通过；诊断刷新200，真实账号额度查询显示accountAuthentication，按钮恢复可用，浏览器错误/警告0，viewport已复原。固定账号/凭据/配置/默认模型、5会话ID及原生文件内容哈希、testvault revision6保持；CPA由正式localStart恢复，cpa-native已可路由。当前快照PID89044 / boot61ec3dac-8731-4e50-8a45-a9400551509a / origin1085，下次须重新发现。最终回执：[ACCEPTANCE.md](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-account-ui-20261006/ACCEPTANCE.md)。账号重新登录由用户完成；提示修复不表示账号已经恢复。

时间日志：[[JOURNAL-account-ui-20261006]]。过程见[本次历程草稿](../../history-drafts/account-ui-20261006.md)。
