# awesome-dsh-plugin 收录材料（提交指引）

## 目标清单

[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（收录标准见其 README「What it takes to be listed here」：
`dsh plugin add` 一行可装 + 描述与实际相符 + 分类正确 + 维护中——逐条自查已满足）。

## 建议词条（英文，放「Workflow & Automation」分类段）

```markdown
- [1225Sakura/oh-my-deepseekharness](https://github.com/1225Sakura/oh-my-deepseekharness) - Multi-agent orchestration layer (omd): 48 bilingual skills, 33 role cards, 34 in-process tools (mode state rides the host storageDomain, mechanical leaf-guard via tools.restrict, session-anchor auto-derived cwd/sessionId), 3 slash commands and a HUD sidebar panel; autopilot/ralph ride host-native goals, team rides host-native agentTeams with five-stage handoff discipline. Install: `dsh plugin --profile web add @sakura12/oh-my-deepseekharness`
```

## 提交步骤（需要你的 GitHub 账号）

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin` → 新分支。
2. 编辑 `README.md`：「Workflow & Automation」分类段按字母序插入上面的词条行（该清单按首字母排序）。
3. 同步 `README.zh.md`（中文清单有对应分类段，中文词条可自译）。
4. PR 标题建议：`Add oh-my-deepseekharness (multi-agent orchestration layer)`；正文提一句：
   installs with `dsh plugin add`, declares `dsh.bundle` manifest, 34 tools / 48 skills verified
   against counts（收录评审会逐个数工具——当前准确数字 34 内置 + 48 skills + 33 角色卡）。

## 提交前自查清单

- [x] `dsh plugin add` 一行可装（npm 包 + dsh.bundle manifest ✓）
- [x] 工具数声明与实测一致（34 = 逐一核对过；收录评审会数）
- [x] 分类正确（多代理编排/工作流）
- [ ] 提交 PR 后盯 review（awesome 维护者会对照源码验证描述）
