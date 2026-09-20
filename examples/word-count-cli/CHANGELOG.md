# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [0.1.0] - 2026-09-20

首个发布版本（autopilot E2E 门禁交付物）。

### Added

- wc 兼容四计数：`-l` 行数 / `-w` 词数 / `-c` 字节数 / `-m` 字符数（Unicode 码点），默认 `-l -w -c`
- `--zh` 中文感知模式：追加 `cjk_chars`（CJK 统一表意文字 + 扩展 A）与 `cjk_words`（非中文词 + CJK 字数）
- 输入：文件参数 / 显式 `-` / 无参读 stdin；多文件末行 `total`（只累计成功读取的文件）
- 列宽自适应右对齐；文件行带文件名、stdin 不带
- `--help` / `--version`；读取失败按 errno 映射报错（ENOENT/EISDIR/EACCES/EPERM）并以 exit 1 退出、其余文件继续
- 29 个测试（node:test，零依赖）：14 单元 + 15 集成（真实 child_process 覆盖 stdin/文件/多文件/错误路径）

### Fixed（QA 循环与评审门记录）

- cjkWords 双重计数：连续汉字段先被 `\S+` 整体计 1 词、又按字数累加——修正为 CJK 字先替换为空格再数非中文词（QA cycle 1，含回归测试）
- 双 `-` 读 stdin 挂起零输出：stdin Promise 惰性缓存复用（code-reviewer R1 [HIGH]，含回归测试）
- 错误消息硬编码 ENOENT：新增 `readErrorReason` 按 err.code 映射（code-reviewer R1 [MEDIUM]）
- stdin 读取错误未捕获：与文件读取统一 try/catch（code-reviewer R1 [MEDIUM]）

### 评审记录

- verifier：7/7 验收标准 VERIFIED，PASS
- code-reviewer：R1 REQUEST CHANGES（1 HIGH + 2 MEDIUM）→ 修复 + 补 5 测试 → re-validation APPROVE
