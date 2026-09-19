# wczh

零依赖 Node.js 字数统计 CLI：`wc` 兼容四计数（行 / 词 / 字节 / 字符）+ `--zh` 中文感知模式。

## 安装

```bash
npm link        # 在本目录执行，之后全局可用 wczh
```

或直接 `node bin/wczh.js ...`，无需任何依赖安装（Node ≥ 18）。

## 用法

```
wczh [选项] [文件...]
  -l          统计行数（'\n' 数）
  -w          统计词数（空白分隔）
  -c          统计字节数（UTF-8）
  -m          统计字符数（Unicode 码点）
  --zh        追加 cjk_chars 与 cjk_words 两列（每个 CJK 字计 1 词）
  --help      显示帮助
  --version   显示版本号
```

- 无文件参数或文件为 `-` 时读标准输入
- 无计数选项时默认 `-l -w -c`（与 `wc` 一致）
- 多文件时末行输出 `total`

## 示例

```bash
$ echo "hello world" | wczh
1 2 12

$ wczh --zh 文章.txt
12 40 1024 880 920 文章.txt

$ wczh -l a.txt b.txt
10 a.txt
20 b.txt
30 total
```

## 与 GNU wc 的差异

- 仅实现 `-l -w -c -m` 四个计数标志；列宽取各行最大位数，不做终端宽度探测
- 重复传 `-` 时 stdin 只读一次并复用结果（GNU wc 第二次读到 EOF 得 0）——显式设计取舍，避免挂起
- 独有 `--zh`：追加 `cjk_chars`（CJK 统一表意文字数，区间 U+4E00–U+9FFF / U+3400–U+4DBF）与 `cjk_words`（英文词数 + CJK 字数，即"每个汉字计 1 词"的中文写作计数惯例）

## 测试

```bash
node --test        # 或 npm test（零依赖，直接跑 node:test）
```
