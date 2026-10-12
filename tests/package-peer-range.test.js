// U9（dsh 0.2.0 兼容发版 0.4.3）peer range 覆盖断言。
// 目的：把「已知宿主版本线 ∈ peerDependencies range」钉死——下次宿主升级静默越界时
// 本测试在 npm test / prepublishOnly 门禁直接变红（仓库无 CI，门禁=本地 npm test）。
// 计划锚点：.omd/plans/ralplan-u9-dsh-02-compat.md（PM-1 矩阵 / AC-2）。
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import semver from 'semver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const DSH_PEERS = [
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-storage',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
];

// 已知宿主版本线样本（PM-1 矩阵）：
// 旧线（0.1.x 兼容线必须保活——只加不减）
const IN_OLD = ['0.1.2-rc.1', '0.1.5-rc.1', '0.1.7-rc.1'];
// 新线（dsh 0.2.0-rc 线 + 0.2.x stable 承诺）
const IN_NEW = ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1', '0.2.7'];
// 范围外（必须不满足）
// - 0.1.3/0.1.6：旧线间隙
// - 0.2.0-rc.0：0.2.0 线地板=rc.1（低于 rc.1 的 0.2.0 预发布不在承诺面）
// - 0.3.0 / 0.3.0-rc.1：上界 <0.3.0（semver 预发布规则：0.3.0-rc.1 无同三元组 prerelease comparator，∉）
const OUT = ['0.1.3', '0.1.6', '0.2.0-rc.0', '0.3.0', '0.3.0-rc.1'];
// 已知盲区（如实钉成契约而非运气）：下一条 rc 线 0.2.1-rc.1 不满足本 range
// （semver 预发布规则——无 0.2.1 三元组的 prerelease comparator）。
// 该复发通道由 omd-doctor 检查项 1 的「宿主版本 satisfies peer range 实测校验」兜底（S-4）。
// 宿主升到 0.2.1-rc 线时本断言不变红；拓宽 range 到 0.2.1-rc 线时本断言应变红，迫使同步更新。
const KNOWN_GAP = ['0.2.1-rc.1'];

describe('U9 peer range 覆盖（package.json vs 已知宿主版本线）', () => {
  test('8 个 @deepseek-ai/dsh-* peer 全部在册', () => {
    for (const name of DSH_PEERS) {
      expect(pkg.peerDependencies[name], `missing peerDep ${name}`).toBeTypeOf('string');
    }
    expect(Object.keys(pkg.peerDependencies).filter(k => k.startsWith('@deepseek-ai/dsh-'))).toHaveLength(8);
  });

  test('8 包范围均含 0.2.0-rc 线加性子句（只加不减）', () => {
    for (const name of DSH_PEERS) {
      const range = pkg.peerDependencies[name];
      expect(range, name).toContain('>=0.2.0-rc.1 <0.3.0');
      // 旧线原样保留
      expect(range, name).toContain('>=0.1.7-rc.1 <0.2.0');
      expect(range, name).toContain('>=0.1.5-rc.1 <0.1.6');
      expect(range, name).toContain('>=0.1.2-rc.1 <0.1.3');
    }
  });

  for (const name of DSH_PEERS) {
    test(`${name}：版本样本矩阵 satisfies 判定`, () => {
      const range = pkg.peerDependencies[name];
      for (const v of [...IN_OLD, ...IN_NEW]) {
        expect(semver.satisfies(v, range, { includePrerelease: false }), `${name} 应含 ${v}`).toBe(true);
      }
      for (const v of OUT) {
        expect(semver.satisfies(v, range), `${name} 不应含 ${v}`).toBe(false);
      }
      for (const v of KNOWN_GAP) {
        expect(semver.satisfies(v, range), `${name} 已知盲区 ${v}（由 doctor satisfies 校验兜底）`).toBe(false);
      }
    });
  }

  test('schemastery 不在拓宽范围（防误伤）', () => {
    expect(pkg.peerDependencies['@deepseek-ai/schemastery']).toBe('^3.18.2');
  });

  test('peerDependenciesMeta：8 包 optional=true 契约不变', () => {
    for (const name of DSH_PEERS) {
      expect(pkg.peerDependenciesMeta?.[name]?.optional, name).toBe(true);
    }
  });
});
