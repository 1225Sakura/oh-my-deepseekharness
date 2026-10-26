# scripts/install-local.ps1
# oh-my-dsh 本地安装链：仓库改动 → 打进 dsh profile → 重启 dsh web 生效。
# 背景（2026-10-26 审查实测）：profile 依赖从 npm 解析旧版（如实装 0.4.9 vs 仓库 0.5.1），
# 仓库里的修复永远到不了运行中的 GUI——本脚本闭合这条链。
#
# 用法：
#   pwsh scripts/install-local.ps1                      # 安装进默认 web profile
#   pwsh scripts/install-local.ps1 -ProfileName web     # 显式指定 profile
#
# 步骤：npm pack → 独立临时目录解包 → 覆盖 profile 内插件目录 → 提示重启 dsh web。
[CmdletBinding()]
param(
  [string]$ProfileName = 'web',
  [string]$ProfileRoot = (Join-Path $env:DSH_HOME 'profiles')
)
$ErrorActionPreference = 'Stop'
# P2-7：ProfileName 防穿越 + DSH_HOME 缺席友好报错
if ($ProfileName -match '[\\/]' -or $ProfileName -match '\.\.') { throw "非法 ProfileName：$ProfileName" }
if (-not $env:DSH_HOME -and -not (Test-Path $ProfileRoot)) { throw "DSH_HOME 未设置且 ProfileRoot 不存在：$ProfileRoot（请用 -ProfileRoot 显式指定）" }
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  $pkg = Get-Content package.json -Raw | ConvertFrom-Json
  Write-Host "== 打包 $($pkg.name)@$($pkg.version)"
  $tgzName = npm pack --pack-destination $env:TEMP 2>$null | Select-Object -Last 1
  $tgz = Join-Path $env:TEMP $tgzName
  if (-not (Test-Path $tgz)) { throw "npm pack 未产出 tgz：$tgz" }

  $profileDir = Join-Path $ProfileRoot $ProfileName
  if (-not (Test-Path $profileDir)) { throw "profile 不存在：$profileDir" }
  $destDir = Join-Path $profileDir 'node_modules\@sakura12\oh-my-deepseekharness'
  Write-Host "== 安装到 $destDir"
  # P1-2 修复（评审）：独立临时目录 + 全流程 finally 清理——中途失败不留残渣混入下次安装
  $extractDir = Join-Path $env:TEMP ('omd-pack-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
  try {
    tar -xzf $tgz -C $extractDir
    if (Test-Path $destDir) {
      $item = Get-Item $destDir
      if ($item.LinkType) { throw "$destDir 是链接（$($item.LinkType)），拒绝覆盖——请人工处置" }
      Remove-Item $destDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Copy-Item (Join-Path $extractDir 'package\*') $destDir -Recurse -Force
  } finally {
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host ""
  Write-Host "完成。重启 dsh web 后生效（client bundle 与宿主插件都在启动时装载）：" -ForegroundColor Yellow
  Write-Host "  1. 关闭当前 dsh web"
  Write-Host "  2. 重新启动 dsh web"
  Write-Host "  3. 右侧栏 guide 页打开「omd HUD」验证：面板应显示当前会话工作区的状态"
  Write-Host "     （也可先 curl "http://127.0.0.1:3080/oh-my-dsh/hud.json?cwd=<项目路径>" 验证数据面）"
} finally { Pop-Location }
