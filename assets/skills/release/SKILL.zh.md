---
name: release
description: 仓库感知的发布助手——从仓库/CI 巡检推导发布规则，缓存进 .omd/RELEASE_RULE.md，再引导版本号、发布说明、打 tag 与发布
when-to-use: 用户（维护者）要求发版（"release"、"发版"、"bump 版本"、"发布 vX.Y.Z"、"准备发布"）。仅维护者流程；绝不绕过仓库自身的发布边界（CI 门禁、保护分支、必需评审）。
---

# Release（发布助手）

一个轻量、仓库感知的发布助手。首次运行时巡检项目与 CI 推导发布规则，缓存进 `.omd/RELEASE_RULE.md`，然后按这些规则引导维护者走完一次发布。不硬编码任何项目专有的版本文件或命令——一切从巡检推导。

**边界：** release 仅维护者可用。本技能**在本地引导并执行**（版本文件、changelog、commit、tag）；任何触及共享远端的动作（push、publish、部署）必须经用户明确确认后才执行。

## 用法

```
release [version] [--refresh]
```

- `version` 可选——`patch`、`minor`、`major` 或显式 semver（如 `2.4.0`）。缺省时展示当前版本并询问（有 `ask_user_question` 就用它）。
- `--refresh` 强制重新分析，即使缓存的规则文件存在。

## 第 0 步 —— 加载或构建发布规则

查 `.omd/RELEASE_RULE.md` 是否存在（用 `glob`/`read`）。

- **不存在或带 `--refresh`：** 跑完整分析（第 1 步）并写文件。
- **存在：** 读文件，然后做增量检查——扫 CI 目录（`.github/workflows/`、`.circleci/`、`Jenkinsfile`、`gitlab-ci.yml`、`bitbucket-pipelines.yml`……）有没有比文件里 `last-analyzed` 时间戳新的改动。相关 workflow 变了就重析对应章节并更新文件。报告变了什么。

## 第 1 步 —— 仓库分析（首次或 --refresh）

从巡检回答以下问题并记录：

1. **版本来源** —— 所有含当前版本字符串的文件（`package.json`、`pyproject.toml`、`Cargo.toml`、`build.gradle`、`VERSION`……）；逐个记录字段/正则。探测发布自动化脚本（`scripts/release.*`、Makefile target、`changesets`、`semantic-release`、`release-it`、`goreleaser`……）。
2. **Registry / 分发** —— npm / PyPI / Cargo / Docker / GitHub Packages / 其他；有没有 tag push 自动发布的 CI job（哪个 workflow、哪个 job）。
3. **发布触发器** —— tag push（`v*`）、`workflow_dispatch`、合并到 main、release 分支合并、commit message 模式。
4. **测试门禁** —— 测试命令及其在 CI 中的位置；发布前是否必须绿；有无绕过开关。
5. **发布说明 / changelog** —— 有无 `CHANGELOG.md`/`.rst`；约定（Keep a Changelog / Conventional Commits / GitHub 自动生成 / 无）；是否有随 tag 提交的 release body 文件。
6. **首次缺口** —— 没有发布 workflow（提议脚手架一个）；构建产物没 gitignore；还没有 git tag（`git tag --list`）。

## 第 2 步 —— 写 `.omd/RELEASE_RULE.md`

```markdown
# Release Rules
<!-- last-analyzed: YYYY-MM-DDTHH:MM:SSZ -->

## Version Sources
## Release Trigger
## Test Gate
## Registry / Distribution
## Release Notes Strategy
## CI Workflow Files
## First-Time Setup Gaps
```

`.omd/RELEASE_RULE.md` 是本地缓存。团队想共享规则就提交它；否则留在 `.omd/` 的 gitignore 伞下。

## 第 3 步 —— 定版本

有参数用参数。否则：展示当前版本，展示 `patch`/`minor`/`major` 各得到什么，问用户。校验结果是合法 semver。

## 第 4 步 —— 发布前检查单

逐项过（从规则推导；至少含）：

- [ ] 本次发布要带的改动都已提交并推送
- [ ] 目标分支 CI 全绿
- [ ] 本地测试通过（跑测试门禁命令——留真实输出当证据）
- [ ] 版本号已 bump 到**所有**版本来源文件
- [ ] 发布说明 / changelog 就绪（第 5 步）

## 第 5 步 —— 发布说明

套用仓库检测到的约定。无约定时的默认指引：

- 开头讲**用户感受到的变化**，不是内部实现。
- 按类型分组：`New Features` / `Bug Fixes` / `Breaking Changes` / `Deprecations` / `Internal`。
- 每条一句话；链接 PR/issue；外部贡献者署名。
- **Breaking changes 排最前**，每条必须带迁移路径。
- 用户不可见的改动（重构、CI 微调）略去，除非影响构建可复现性。

若用 Conventional Commits，从 `git log <prev-tag>..HEAD --no-merges --format="%s"` 按类型分组生成草稿；给用户看并允许修改。

## 第 6 步 —— 执行

1. **bump** 每个版本来源文件（`edit` 工具）。
2. **跑测试** —— 测试门禁命令；贴真实输出。
3. **commit** —— `git add <版本文件> CHANGELOG.md`，message `chore(release): bump version to vX.Y.Z`（可用 dsh `git_commit`）。
4. **打 tag** —— `git tag -a vX.Y.Z -m "vX.Y.Z"`（优先 annotated）。
5. **push** —— `git push origin <branch> && git push origin vX.Y.Z`。**先拿用户明确确认**——对 CI 触发型发布这是不可回退点。
6. **CI 接管** —— 若触发器是 tag push，点名预期 workflow 文件及它会做什么（发布、建 GitHub Release）。
7. **手动发布** —— 无 CI 自动化时，列出确切的手动命令（`npm publish --access public`、`twine upload dist/*`……），由用户跑或确认后跑。

## 第 7 步 —— 首次设置建议

第 1 步发现缺口时提供具体帮助：脚手架一个 `v*` tag 触发的发布 workflow、建首个 tag、把构建产物加进 gitignore。每一项都是独立的、需确认的改动。

## 第 8 步 —— push 后验证

- CI 状态：`gh run list --workflow=<发布 workflow> --limit=3`（有 `gh` 的话）。
- 几分钟后查 registry 是否出现新版本。
- GitHub Release 是否建成：`gh release view vX.Y.Z`。

带证据报告成功，或精确指出失败点。

## 状态契约

release **不持 omd 模式状态**：无 `state_write`/`state_clear`。唯一的持久产物是 `.omd/RELEASE_RULE.md` 缓存（外加经用户确认创建的发布 commit/tag）。push、publish、任何部署动作执行前一律要用户明确确认。
