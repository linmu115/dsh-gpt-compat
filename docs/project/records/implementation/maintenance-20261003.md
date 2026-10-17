---
id: IMP-maintenance-20261003
kind: implementation
title: RC2 进程所有权与 CPA 候选凭据维护
status: current
progress: complete
summary: 退出确认、候选凭据保存及审阅发现的 pending 观察时限问题已修复，独立46项回归、完整132项回归及真实模型压缩/冷恢复通过；两包已安装并完成重启保留验收。
relations:
  - relation: implements
    to: {record_id: MOD-tools}
    reason: 进程退出确认与可重试的清理所有权
  - relation: implements
    to: {record_id: MOD-accounts}
    reason: 候选密钥契约校验成功后才保存
sources:
  - path: ../../src/processes.ts
  - path: ../../src/accounts/cpa.ts
  - path: ../../tests/processes.spec.ts
  - path: ../../tests/accounts.spec.ts
---

# 2026-10-03 维护计划与进度

目标为准确 DSH `0.2.0-rc.2`、Cordis `4.0.4` 和既有独立宿主 `gpt-dsh02.1`。已安装 GPT `0.5.0-dsh02.2` / Accounts `0.1.4-dsh02.3`；不改变宿主持久格式、不开发外置 Engine、不改变固定账号选择；根任务负责实际验收。[仓库维护记录](../../../maintenance-20261003.md)保留封包时静态范围，最终实际结果见[本轮验收汇总](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/ACCEPTANCE.md)及其JSON证据。

## 范围及验收门

- 命令必须保留所属进程范围直到后端明确确认退出；关闭、取消、晚到句柄、观察 false/异常/缺失不得输出虚假的 stopped 或丢弃所有权。普通收集必须同时保留有界等待和可继续操作的句柄。
- 管理凭据候选必须通过账号枚举和固定路由契约再一次保存；失败保留旧值，保持串行操作，不改变实际选号。
- 准确发行包需通过类型、回归、构建及包校验，再由根任务进行独立 RC2 真实模型、压缩与新进程接续验收。合成模型不替代真实请求；未取得证据不记为已安装。

## 已完成与审阅发现

Accounts 新增 6 例先跑红（6 failed / 8 passed），修后 14/14 通过。401、404、缺契约、错误选择字段和坏 JSON 均不写入；成功路径两个请求都用候选 key，验证结束后只写一次且不读取旧 key。`tsc --noEmit -p tsconfig.compat02.json` 通过。

ProcessPool 对 false/异常/缺失观察、关闭重试、并发关闭、准备阶段取消、多个 owner 清理等新增覆盖；独立复跑 `tests/processes.spec.ts` 与 `tests/accounts.spec.ts` 共 30/30 通过。这只证明当时定向测试覆盖。

Astra 独立审阅补充发现：当父进程已结束而范围退出观察仍 pending，普通 collect 无条件等待，可能超过 `yieldMs`，首次调用尚未返回句柄。纯内存探针设 yield=0，50ms 后仍 pending，释放观察后才完成；未启动子进程。此时30项绿测没有覆盖该条件，负结果保留。

随后维护代理补修：只在剩余 yield 预算内等待范围观察，未完成时返回同一 `Process closing with session ID`，不输出 exited、不终止仍运行的范围、不释放容量；显式取消/关闭仍等待确认。新增初次 yield=0/20 与后续 write_stdin 三例，Astra 只读复核并独立复跑进程、账号、Loader 共46/46通过。仅既有SDK缺 `checkpoint.js.map` 警告；本次审阅未发现剩余阻断回归。普通轮询时限与完整关闭保证分开验证，不把父进程退出当作整个范围退出。

## 发行、真实验收与安装结果

根任务完成完整回归132通过、1项可选测试跳过，新离线fixture 6/6通过。准确候选文件与摘要由[packages.json](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/packages.json)记录。首次[live-acceptance.json](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/live-acceptance.json)因测试判断未容忍末尾换行而安全拒绝，执行工具0次；只修fixture规范化后，[第二次真实验收](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/live-acceptance-2.json)通过。使用固定账号的真实Astra/high，6次请求含2次compact；两个进程经严格原生JSONL冷恢复保留opaque checkpoint，一次apply_patch、恢复后零次重执行，marker正确。首次负结果不删除、不改写为产品故障。

[installation.json](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/installation.json)确认仅更新GPT/Accounts两包，其他依赖及配置保持；源宿主gpt-dsh02.1未重建，SM临时隔离保持。[start.json](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/start.json)及[安装后检查](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/post-install-check.json)通过：本轮回执PID67748、origin http://127.0.0.1:39073、boot d3cfbc6c-0fbe-4fe9-940d-1939db5495f1，5个原会话ID保持且全部idle，默认模型/凭据/固定账号未变，testvault revision6仍绑定i0502/web-i0502。端口/PID是该次启动证据，后续操作必须重新核实。停机后CPA处于stopped，由根任务使用正式localStart恢复，[恢复回执](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/cpa-after-restart.json)通过。

## 当前边界

上述结论限于本轮精确两包、固定账号和受限真实脚本，不代表任意长任务、全部模型、成本收益或历史批量迁移已验收。旧版本回执、历史失败和冻结清单保持。源码中生命周期策略仅适用于本插件拥有的命令，不授权操作用户实例或其他进程。开发过程见 [历程草稿](../../history-drafts/maintenance-20261003.md)；未伪造正式历史事件索引。
