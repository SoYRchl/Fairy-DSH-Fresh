/*
 * 一键复现（bootstrap）契约检查
 *
 * 为什么存在
 * ----------
 * 「换台机器按 README 能拉起同一状态」这句话要成立，靠的是三个前提，而这三个前提
 * 全都是**会静默失效**的：
 *
 *   1. 依赖分两处装 —— `profiles/web` 和 5 个插件包各自的 node_modules。只装一处，
 *      插件加载不全，而且**不报错**。
 *   2. pnpm 11/12 **不建 `link:` 链接**（`profiles/web/node_modules` 里少 5 个 junction），
 *      同样不报错，表现为插件不 activate。
 *   3. git checkout 按索引顺序写盘，`package.json` 常比 `lib/*` 产物新几十毫秒，
 *      build-freshness 契约误报 —— 而正确修法是**推 mtime**，不是重建（重建会抹掉
 *      `lib/client.js` 里的 compat 层 = 白屏）。
 *
 * 这个文件把这三个前提钉成断言：装包点数量、link 依赖清单、以及三个脚本的存在性
 * 与幂等用法。它只做**纯静态/只读**检查，不跑 pnpm，所以在任何环境都稳定。
 *
 * 运行：node --test tools/tests/bootstrap.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const PROFILE = join(ROOT, 'profiles', 'web');
const TOOLS = join(ROOT, 'tools');

const manifest = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'));

function linkDeps() {
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('link:'))
    .map(([name, spec]) => ({ name, dir: resolve(PROFILE, spec.slice('link:'.length)) }));
}

test('bootstrap：装包点 = 5 个 link 依赖 + profiles/web 本身', () => {
  const links = linkDeps();
  // 数字写死是故意的：新增/移除插件包时这里会红，提醒同步 README 第十九节与
  // restore-link-deps.mjs 的说明。
  assert.equal(links.length, 5, 'link: 依赖数量变了，同步 README §19 与 bootstrap 文档');

  for (const { name, dir } of links) {
    assert.ok(
      existsSync(join(dir, 'package.json')),
      `link 依赖 ${name} 的目标缺少 package.json：${dir}`,
    );
  }
  // 6 = 5 个插件包 + profiles/web
  assert.equal(links.length + 1, 6);
});

test('bootstrap：依赖确实要分两处装（每个插件包都是独立装包点）', () => {
  // 这条守的是最容易被省掉的一步：只在 profiles/web 跑一次 pnpm install。
  // 每个 link 依赖都有自己的 package.json ⇒ 都有自己的依赖树要装。
  for (const { name, dir } of linkDeps()) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(
      pkg.name,
      name,
      `${dir} 的 package.json name 与 link 依赖名不一致（${pkg.name} != ${name}）`,
    );
  }
});

test('bootstrap：三个脚本都在，且 README 有对应章节', () => {
  for (const script of ['bootstrap.mjs', 'restore-link-deps.mjs', 'bless-build-mtimes.mjs']) {
    assert.ok(existsSync(join(TOOLS, script)), `缺少 ${script}`);
  }

  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('bootstrap.mjs'), 'README 没提 bootstrap.mjs（换机复现的唯一入口）');
  assert.ok(
    readme.includes('pnpm 11/12 不建'),
    'README 没写「pnpm 不建 link: 链接」这条坑',
  );
});

test('bootstrap：restore-link-deps 的用法是幂等的（--apply 可重复跑）', () => {
  const src = readFileSync(join(TOOLS, 'restore-link-deps.mjs'), 'utf8');
  // 幂等 = 链接已指向正确目标时不重建。这条特征串是幂等分支的判据。
  assert.ok(
    src.includes('isLink && got && want'),
    'restore-link-deps.mjs 缺少「已就位就不动」的幂等分支',
  );
  assert.ok(
    src.includes('--apply'),
    'restore-link-deps.mjs 缺少 --apply（默认必须只报告，不能直接改）',
  );
});

test('bootstrap：mtime 归位脚本不能重建产物（只能推时间戳）', () => {
  const src = readFileSync(join(TOOLS, 'bless-build-mtimes.mjs'), 'utf8');
  // 红线：lib/* 是权威产物，含 compat 层，从 src 重建 = 白屏。
  assert.ok(
    src.includes('utimesSync'),
    'bless-build-mtimes.mjs 应当只改 mtime（utimesSync）',
  );
  assert.ok(
    !/\bexecSync\b|\bspawnSync\b/.test(src),
    'bless-build-mtimes.mjs 不该调用构建命令（产物是权威，禁止重建）',
  );
});
