---
{"id":"VER-cpa-start","kind":"verification","title":"本机 CPA 启动按钮验证","status":"current","summary":"真实设置页启动 CPA 通过；覆盖重复启动、主题和窄卡片，保留故障与恢复边界。"}
---

# 本机 CPA 启动按钮验证

2026-09-18 最终安装：账号模块 **0.1.3**；GPT 主插件以 0.5.0-dev.8 为基线，仅客户端增量，manifest 和会话格式入口字节不变。目标是 0.1.5-rc.2 副本 / web。

真实设置页已通过：进入“设置 → GPT 适配 → CPA 账号”，点击“启动本机 CPA”一次，状态由未运行变为已运行；账号列表恢复，返回 2 个账号及 fixed 模式。随后两次启动请求均返回已运行，OS 核验仅一个目标 CPA 进程。CPA 启动期间 DSH 的 bootId 保持不变。未发送模型请求、切换账号、添加账号或退出登录。

- 类型检查和发行构建通过；全套 **88 项测试通过、1 项真实模型网络测试跳过**。涵盖点击合并、重复启动、未配置、端点识别、启动失败与超时、响应上限、离线按钮、账号刷新及文件错误诊断脱敏。
- 真实浏览器卡片已人工查看浅色、暗色及 320px 宽度截图，无横向溢出；页面未捕获异常数为 0。320px 是卡片宽度测试，不代表完整手机布局验收。
- 目标稳定实例 ID 为 i-7ecb6c19-80a5-4c2e-97e6-484bbfc0e926；本次运行 bootId 为 5c70b708-f8f4-43e7-842d-9419ab58d142，run-cf18aaf6-8b8f-4ef7-aba6-37fbca6859ca 为 running，Engine ready。地址为当次动态地址，不写入功能配置。
- 三次增量安装均有备份并保持 19 个原有格式绑定固定文件不变；保留其他插件、Launcher hook、维护范围与其他接入绑定。账号模块与 Maintenance 会话格式分离。
- 凭据沿用原值，部署到 CPA 目录的私有子目录；保留原访问权限并加入本机 Git 排除。后端配置热更新后检查通过。密码内容、登录令牌和会话正文未写入验证报告。

## 故障与恢复边界

0.1.1 页面按钮出现，但真实启动返回 localConfigInvalid；0.1.2 将失败缩小为 localPasswordMissing。0.1.3 日志进一步确认：运行中的 DSH 对原 AppData 密码文件执行 stat 返回 ENOENT，配置路径长度和 SHA-256 与独立 Node 检查完全一致，而独立检查显示文件存在。改用 CPA 目录中的同值凭据文件后真实启动通过。此结论证明路径迁移恢复可用，**尚未确认原 AppData 路径在不同进程中可见性不同的底层原因**。规范化 Windows 路径同时修复了已有进程检测的正反斜杠差异，但不是该 ENOENT 的已确认原因。

期间一次进程诊断产生 ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING 未捕获拒绝，导致 DSH 异常退出。这是本任务诊断操作造成的副作用。维护数据库最终为 recovered，Launcher handle 为 finalized/recovered，不能称为正常 closed。之后通过官方接入 repair 和正式 Start 恢复，新 run 已核验 running；调试端口已关闭。详细经过见 [[HIST-cpa-start]]。

本机脱敏证据在 artifacts/cpa-start-20260918/verification.json、同目录卡片截图、artifacts/cpa-start-20260918-r3/deployment.json 和 start-binding-repaired.json；这些运行产物不随公共源码分发。

配置路径更新后的正式在线 repair 也已核验：接入 connected、issues 为空，同一 boot/run 持续 running，19 个固定文件、其他绑定、维护范围、hook 内容及 required 集合保持不变。修复并非严格的仅写指纹操作；实际结果以 artifacts/cpa-start-20260918-r3/repair-live/verified.json 为准。

关联：[[MOD-accounts]]、[[HIST-cpa-start]]。
