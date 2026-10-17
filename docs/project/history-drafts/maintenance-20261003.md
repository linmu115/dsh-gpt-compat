# 2026-10-03 GPT Compat 维护历程草稿

整理者：Astra。范围：本次公开任务要求、只读源码审阅、定向测试回执。适用 GPT `0.5.0-dsh02.2` / Accounts `0.1.4-dsh02.3` 候选及准确 RC2。来源尚未导入可展开事件索引，本文件是有出处的草稿，不声明正式 history 绑定。

根任务要求保留进程所有权直到退出确认，并修复 CPA fixed-routing 验证失败覆盖旧管理凭据的问题。Accounts 先增加 6 个反例，全部因提前写入而失败；之后仅调整候选验证顺序，14项测试及RC2类型检查通过。新请求始终使用候选 key，不读取或输出真实凭据。

随后独立审阅 ProcessPool 全部源码差异，联合复跑30项通过，但发现普通 collect 对 pending observer 无时限等待。内存探针 yield=0 / 50ms 仍 pending，手动完成观察后返回，未生成真实子进程。反馈根任务后，维护代理补修为普通收集在剩余预算到期时返回同一 closing 句柄，显式取消/关闭保留严格退出确认。Astra复核该修复并独立复跑进程、账号及Loader共46项通过；源码审阅没有剩余阻断发现，当时发行及真实验收仍待补充，后续结果如下。

本次只更新受影响地图和研发资产，不重建全图、不修改业务数据、不扩大受限脚本验收为全部模型或任意长任务通过。当前成果入口：[[IMP-maintenance-20261003]]。

根任务随后完成发行及实际部署：完整132pass/1skip、离线6pass；首次真实脚本因尾换行strict predicate安全拒绝且0exec，修fixture normalize后第二次真实Astra/high固定账号通过。两进程严格原生JSONL恢复保留opaque checkpoint，6请求含2compact，一次apply_patch且恢复0次，marker正确。精确更新GPT .2/Accounts .3，其他配置依赖保持；正常启动后5会话ID全部idle，默认/凭据/账号保持，Vault rev6同一绑定。CPA停机后由正式localStart恢复；源宿主未重建、SM隔离保持。当前回执PID67748/origin39073，非永久地址。实际操作归根任务，本代理只同步脱敏证据，不改变固定账号选择。最终依据：[验收汇总](C:/Users/19717/OneDrive/文档/ChatGPT/dsh/artifacts/gptcompat-maintenance-20261003/ACCEPTANCE.md)。
