---
{
  "id": "HIST-image-context",
  "kind": "history",
  "title": "图片发送、预算和压缩接续的修复过程",
  "date": "2026-09-17",
  "status": "current",
  "modules": [
    "GPT 适配"
  ],
  "outcome": "修复已部署，Launcher 已就绪、Maintenance 新运行正常；用户真实会话发送仍待验收",
  "summary": "图片发送、预算和压缩接续的修复过程；保留失败阶段、用户纠偏与实际验证边界。",
  "applicability": "DSH 0.1.5-rc.2；Core 0.3.12-rc2.13；GPT 0.5.0-dev.4；Maintenance Engine 0.1.33-rc2.32。",
  "coverage_note": "Codex 于 2026-09-17 整理；本任务公开来源 316–1281 行。扩展为完成阶段快照，保留此前截止 966 行的索引。仅保存定位与指纹，不复制原始载荷或隐藏推理。",
  "history": {
    "path": "history/image-context-20260917-complete",
    "sha256": "407f4170a19105a32312380245772b3a1d31efb91ec704a5c233e13a1340a306",
    "capture_sha256": "d90ea2caa02f3d2caa72a0a880129b17ee38c4a3d19cc4af6d5ccec7a02462d6"
  },
  "related_records": [
    "REQ-image-context",
    "IMP-image-context",
    "VER-image-context"
  ]
}
---

# 图片发送、预算和压缩接续的修复过程

用户明确取消过滤图片，要求保留会话图片，并批准补齐 Core 预算和 GPT 图片输入、预算及压缩验证。

[查看依据：批准修复方案](history-event:EVT-c84211d2df6f50593fd8)

原实现将模型能力声明为纯文本，请求转换器直接拒绝图片。修复加入持久附件引用与发送边界读取，普通发送、远端计数、原生压缩走同一图片转换路径。预算单独估计视觉内容，不把 base64 当成文字 token。

v2 压缩只在完整检查点成功返回后，才用检查点接续旧图；原始会话附件保留，近期消息原样保留。通用摘要加入图片预算和视觉信息保留要求。取消、缺失存储、无效引用、字节超限及失败压缩均不提交半成品。

离线 69 项通过、1 项可选 live 单测跳过。额外真实 CPA 合成图：先识别红色与 47；压缩请求只包含用户图文，不包含首次模型答案；接续时不再附图，仍回答 Red 47。本地估算从 6243 降到 284，不代表准确计费或所有图片无损。

[查看依据：真实图像压缩后回忆通过](history-event:EVT-cfad6871183e66123f6c)

实现 ce067a2 推送到 codex/image-context-20260917，安装为 0.5.0-dev.4。用户要求用 Git 回滚、不另建实例备份目录，按此执行。

[查看依据：用户纠正备份方式](history-event:EVT-a68510888bcd87c8f767)

部署衔接有遗漏：首次交付没有更新 Maintenance 的插件版本名单及构件校验。随后用户重启遇到阻塞，进一步修复 Maintenance 的兼容声明、校验回执和历史标记恢复。不能把此前模块测试通过当作整实例已可重启的证据。

[查看依据：用户要求先处理启动](history-event:EVT-f14f143d9aab05393912)

Maintenance 新引擎已重启，旧运行已 recovered、生命周期句柄 finalized；已唤起 Launcher，当前证据截止时尚未收到新的实例就绪日志。用户真实会话发送仍待验收。

[查看依据：恢复状态已落盘](history-event:EVT-73ac295b57e66220f496)


## 后续启动验证与纠偏

用户再次点击仍失败，证明旧运行恢复不等于新实例可启动。继续检查发现实例绑定指纹未更新；执行正式修复接入时，又发现发布目录内的适配检查 worker 仍是旧版，拒绝 GPT dev.4。同步构建 worker 后，正式 repair 检查通过，接入状态 connected、issues 为空，且没有重新安装其它插件。

重新触发 Launcher 后，2026-09-17 23:05:23 报告当前副本已就绪；Maintenance 新运行 running、旧运行 recovered。使用启动地址及正常 Cookie 流程读取页面返回 HTTP 200、HTML 有效。真实用户会话发送尚未代发。

[查看依据：已认证页面验证成功](history-event:EVT-cdc23970a73efde602c4)

后续部署必须同时检查引擎、独立适配 worker、宿主格式回执及实例绑定，再以 Launcher 就绪和新运行状态验收；仅重启引擎不足以证明升级完成。
