import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

import { APPROVED } from '../preflight-build.js';

const verifier = fileURLToPath(new URL('../preflight-build.js', import.meta.url));
const approvedProfile = fileURLToPath(new URL('../../profiles/web/', import.meta.url));
const packages = [
  ['dsh-browser-dock', 'browser-dock'],
  ['dsh-balance-meter', 'balance-meter'],
  ['dsh-fairy-startup', 'fairy-startup'],
  ['dsh-fairy-visual', 'fairy-visual'],
  ['dsh-fairy-voice', 'fairy-voice'],
];

/*
 * 这些用例以前依赖**本机** `~/.local/lib/node_modules/@deepseek-ai/dsh`：
 * 只要那台机器上的内核版本/哈希与 APPROVED 不符就恒红，在 CI 上必然失败。
 * 现在改成：夹具里造一份假的官方 dsh + 官方运行时，并把 APPROVED 原样导出、
 * 只替换 runtimeSha256，通过 DSH_PREFLIGHT_APPROVED_FILE 注入 —— 生产闸门
 * 仍然是 preflight-build.js 里那份硬编码 pin，测试只是让它可移植。
 */
function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-preflight-test-'));
  const profile = join(root, 'profiles', 'web');
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: {
      ...Object.fromEntries(packages.map(([name, folder]) => [name, `link:../../${folder}/${name}`])),
      'dsh-message-edit': '0.2.3',
      'dsh-reasoning-effort': APPROVED.locks['dsh-reasoning-effort'].specifier,
    },
  }));
  copyFileSync(join(approvedProfile, 'pnpm-lock.yaml'), join(profile, 'pnpm-lock.yaml'));
  copyFileSync(join(approvedProfile, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml'));
  mkdirSync(join(profile, 'patches'), { recursive: true });
  // 只复制仍然被 pin 的补丁：0.8.1 的 reasoning-effort 已不再打补丁（T-107）。
  for (const patch of ['dsh-message-edit@0.2.3.patch']) {
    copyFileSync(join(approvedProfile, 'patches', patch), join(profile, 'patches', patch));
  }
  const nodeModules = join(profile, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });
  for (const [name, folder] of packages) {
    const source = join(root, folder, name);
    mkdirSync(join(source, 'lib'), { recursive: true });
    writeFileSync(join(source, 'package.json'), JSON.stringify({
      name,
      main: './lib/index.js',
      exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    }));
    if (name === 'dsh-fairy-visual' || name === 'dsh-browser-dock') {
      mkdirSync(join(source, 'src', 'client'), { recursive: true });
      writeFileSync(join(source, 'src', 'client', 'index.js'), 'export function apply() {}\n');
    }
    writeFileSync(join(source, 'lib', 'index.js'), 'export function apply() {}\n');
    writeFileSync(join(source, 'lib', 'client.js'), `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: () => ({}) });\n`);
    // ★ 必须用绝对目标 + 'junction'：
    //   ① 相对目标在 Windows 上不可靠（symlinkSync 报成功，lstat 却 ENOENT）；
    //   ② 目录型符号链接需要管理员/开发者模式，junction 不需要。
    //   这条是 dsh-ops §3 坑 2 里就记过的做法。
    symlinkSync(source, join(nodeModules, name), 'junction');
  }

  // 夹具自带的"官方 dsh"与"官方运行时"，让用例与宿主机解耦。
  const officialDsh = join(root, 'official-dsh');
  mkdirSync(officialDsh, { recursive: true });
  writeFileSync(join(officialDsh, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: APPROVED.dshVersion }));
  const officialRuntime = join(root, 'official-runtime', 'lib', 'client.js');
  mkdirSync(join(root, 'official-runtime', 'lib'), { recursive: true });
  writeFileSync(officialRuntime, '/* fixture official runtime */\n');
  const approvedFile = join(root, 'approved.json');
  writeFileSync(approvedFile, JSON.stringify({
    ...APPROVED,
    runtimeSha256: createHash('sha256').update(readFileSync(officialRuntime)).digest('hex'),
  }));

  return { root, profile, officialDsh, officialRuntime, approvedFile };
}

/*
 * yaml 解析器的锚点（★ 2026-10-19）
 * ------------------------------
 * 产线里 preflight 从**官方 DSH 安装**里解析 yaml（内核依赖它），这没问题。
 * 但夹具里的「官方 dsh」是假的 package.json，不可能自带解析器；而 CI 上也没有
 * 本机那份 ~/.local/lib 全局安装 —— 于是六个用例在 CI 恒红（profile_lockfile /
 * MODULE_NOT_FOUND），本地却因为机器上恰好有全局安装而全绿。这就是「假绿」。
 *
 * 正解：从本仓库**自己**已安装的依赖里取 yaml。fairy-voice 与 balance-meter 都把
 * yaml 作为依赖安装（CI 也会装），任取其一作为 createRequire 的锚点。
 */
function resolveYamlAnchor() {
  for (const relative of ['../../fairy-voice/dsh-fairy-voice/', '../../balance-meter/dsh-balance-meter/']) {
    const directory = fileURLToPath(new URL(relative, import.meta.url));
    const manifest = join(directory, 'package.json');
    try { createRequire(manifest).resolve('yaml'); return manifest; } catch { /* 试下一个 */ }
  }
  return null;
}
const YAML_ANCHOR = resolveYamlAnchor();

function runVerifier(fixture, extraEnv = {}) {
  return spawnSync(process.execPath, [verifier], {
    env: {
      ...process.env,
      DSH_HOME: fixture.root,
      DSH_OFFICIAL_PACKAGE: join(fixture.officialDsh, 'package.json'),
      DSH_OFFICIAL_RUNTIME: fixture.officialRuntime,
      DSH_PREFLIGHT_APPROVED_FILE: fixture.approvedFile,
      ...(YAML_ANCHOR ? { DSH_YAML_ANCHOR: YAML_ANCHOR } : {}),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

test('accepts complete bundles and profile links', (t) => {
  /* 找不到 yaml 就**大声失败**，不要静默跳过：跳过了等于这条闸门没人守。 */
  assert.ok(YAML_ANCHOR, '本仓库的 fairy-voice / balance-meter 里应能解析到 yaml（CI 会 pnpm install 它们）');
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const result = runVerifier(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DSH_PREFLIGHT status="passed" packages="5"/);
});

test('fails before launch when a client bundle is missing', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const client = join(fixture.root, 'fairy-visual', 'dsh-fairy-visual', 'lib', 'client.js');
  assert.equal(existsSync(client), true);
  unlinkSync(client);
  const result = runVerifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scope="package_entry" package="dsh-fairy-visual".*client\.js.*actual="ENOENT"/);
});

test('fails when a profile link targets the wrong package', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const nodeModules = join(fixture.root, 'profiles', 'web', 'node_modules');
  const link = join(nodeModules, 'dsh-fairy-visual');
  unlinkSync(link);
  symlinkSync(join(fixture.root, 'fairy-voice', 'dsh-fairy-voice'), link, 'junction');
  const result = runVerifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scope="profile_symlink" package="dsh-fairy-visual"/);
});

test('fails before launch when Visual source is newer than its bundle', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const source = join(fixture.root, 'fairy-visual', 'dsh-fairy-visual', 'src', 'client', 'index.js');
  const future = new Date(Date.now() + 5_000);
  utimesSync(source, future, future);
  const result = runVerifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scope="build_freshness" package="dsh-fairy-visual".*Review the source change and rebuild/);
});

test('fails when a package cannot be resolved through the profile exports', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const manifest = join(fixture.root, 'fairy-visual', 'dsh-fairy-visual', 'package.json');
  writeFileSync(manifest, JSON.stringify({
    name: 'dsh-fairy-visual',
    main: './lib/index.js',
    exports: { '.': './lib/index.js' },
  }));
  const result = runVerifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scope="package_entry" package="dsh-fairy-visual".*resolvable exports/);
});

test('fails when the profile dependency declaration drifts', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const profilePackage = join(fixture.root, 'profiles', 'web', 'package.json');
  writeFileSync(profilePackage, JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: {
      ...Object.fromEntries(packages.map(([name, folder]) => [name, `link:../../${folder}/${name}`])),
      'dsh-message-edit': '0.2.3',
      'dsh-reasoning-effort': 'github:HanaAyane/dsh-reasoning-effort#main',
      'dsh-fairy-visual': 'link:../../fairy-voice/dsh-fairy-voice',
    },
  }));
  const result = runVerifier(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scope="profile_dependency" package="dsh-fairy-visual"/);
});
