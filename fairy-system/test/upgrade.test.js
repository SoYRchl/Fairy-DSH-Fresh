import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * upgrade-preflight 的 0.2.x 语义级重写（T-114）
 * ============================================
 * 旧版这套用例是 0.1.1-rc.2 时代写的，直接引用：
 *   · 夹具取 homedir()/.dsh/profiles/web 与 ~/.local/.../dsh-client-runtime/lib/client.js；
 *   · 断言 @deepseek-ai/dsh-settings 0.1.1-rc.2 / dsh-reasoning-effort 0.6.2 / 哈希 13a5fe0e…。
 * 0.2.x 之后这些**前提全部作废**：
 *   (a) dsh-client-runtime 已被拆成 dsh-client-modules + dsh-client-store，旧路径不存在；
 *   (b) 官方 conversation 包已不再导出 MutableChatNodeStore；
 *   (c) reasoning-effort 已从 0.6.2 迁到 0.8.1（且不再走 codeload，改 git+ssh）。
 * 现在的做法：**不再依赖本机 home / 本机已安装的官方包**，而是按 upgrade-preflight.js
 * 当前审查的契约现场造一个自洽的候选夹具（profile + 包 + 官方运行时 + capability matrix），
 * 再显式传 --profile/--runtime/--expected-* 与 DSH_CAPABILITY_MATRIX 驱动闸门。
 * 版本号/包名取当前现状（0.2.1-rc.2；运行时包名 dsh-client-modules）；闸门内部仍按
 * 0.1.1-rc.2 时代的契约校验（MutableChatNodeStore、slots.inject、voice 的 settings.section），
 * 这些在 0.2.x 上游已经不存在 —— 所以额外用三条用例断言闸门在遇到 0.2.x 现状时会
 * **怎么 fail closed**，并在注释里写清为什么（这正是"改成断言当前闸门实际行为"）。
 */

const scriptPath = fileURLToPath(new URL('../upgrade-preflight.js', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
// 显式 profile 根：env 可覆盖，默认本仓自带的 B 线 profile（不再取 homedir()/.dsh）。
const PROFILE_ROOT = process.env.DSH_UPGRADE_PROFILE || join(repoRoot, 'profiles', 'web');
const CAPABILITY_MATRIX_SOURCE = join(repoRoot, 'fairy-system', 'capability-matrix.json');

// 闸门当前审查的取值（与 upgrade-preflight.js 顶部常量保持一致；测试显式断言它们）。
const DSH_VERSION = '0.2.1-rc.2';
const DSH_SETTINGS_VERSION = '0.1.1-rc.2';
const REASONING_VERSION = '0.8.1';
const MESSAGE_EDIT_VERSION = '0.2.3';
const REASONING_COMMIT = 'a94d646f61eb3c0966c833ee8f5ad62f8e1b5bad';
const REASONING_SOURCE = 'github:HanaAyane/dsh-reasoning-effort#' + REASONING_COMMIT;
const REASONING_LOCK_SOURCE = 'git+ssh://git@github.com/HanaAyane/dsh-reasoning-effort.git#' + REASONING_COMMIT;
const MESSAGE_EDIT_PATCH_HASH = '48aa0b78c2890276d29446c56e3a3cfaefd8f2ee7723b4a0206a5d35eec862ec';
const REASONING_PEERS = {
  react: '^18.2.0',
  '@deepseek-ai/cordis': '^4.0.1',
  '@deepseek-ai/dsh-client-store': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-client-connection': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-client-locale': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-client-ui-conversation': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-client-ui-model-selection': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-client-ui-settings': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-client-ui-slots': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-client-ui-renderer': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-api-session-controller': '^0.2.0-rc.1',
  '@deepseek-ai/dsh-api-remotes': '^0.2.0-rc.1',
};

const LOCAL_PACKAGES = [
  ['dsh-browser-dock', 'browser-dock'],
  ['dsh-balance-meter', 'balance-meter'],
  ['dsh-fairy-startup', 'fairy-startup'],
  ['dsh-fairy-visual', 'fairy-visual'],
  ['dsh-fairy-voice', 'fairy-voice'],
];

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// Windows 必须用绝对目标 + junction：相对目标会"报成功但 lstat ENOENT"，
// 目录符号链接又需要管理员/开发者模式（同 preflight.test.js 的既有做法）。
function symlinkDir(target, linkPath) {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function moduleLoader(id) {
  return 'window.__ModuleLoader__.load({\n  id: ' + JSON.stringify(id) + ',\n  factory: (require) => ({}),\n});\n';
}

/*
 * 造一个**自洽**的候选夹具：内容由 capability-matrix.json 反推，闸门查什么就写成什么。
 * 这样用例只验证闸门逻辑，不依赖本机是否装了某个版本的官方包（旧版的最大问题）。
 * 变体用来复现 0.2.x 上游已经发生的漂移（见文件顶部说明）。
 */
function createFixture(options = {}) {
  const {
    runtimeLifecycle = 'reviewed',   // 'current-0-2-x' => 运行时不再暴露 slots.inject
    conversationStore = 'reviewed',  // 'current-0-2-x' => conversation 包不再有 MutableChatNodeStore
    voiceSettingsSlot = 'reviewed',  // 'current-0-2-x' => voice 包不再注册 settings.section
  } = options;

  const root = mkdtempSync(join(tmpdir(), 'dsh-upgrade-preflight-'));
  const profile = join(root, 'profiles', 'web');
  const nodeModules = join(profile, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });

  // ---- 官方运行时（0.2.x 的 dsh-client-modules，不再叫 dsh-client-runtime）----
  const runtime = join(root, 'dsh-client-modules', 'lib', 'client.js');
  mkdirSync(dirname(runtime), { recursive: true });
  const lifecycle = runtimeLifecycle === 'reviewed'
    ? '// Reviewed client-module lifecycle hooks: ctx.effect + slots.inject\n'
    : '// 0.2.x dsh-client-modules 只保留 ctx.effect，生命周期注入钩子已移除\nctx.effect;\n';
  writeFileSync(runtime, 'window.__ModuleLoader__.load({\n  factory: (require) => ({}),\n});\n' + lifecycle);
  writeFileSync(join(root, 'dsh-client-modules', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-modules', version: DSH_VERSION }));

  // ---- capability matrix：复用本仓审查版，只把版本/哈希换成当前现状 ----
  const matrix = JSON.parse(readFileSync(CAPABILITY_MATRIX_SOURCE, 'utf8'));
  matrix.matrixId = 'dsh-' + DSH_VERSION;
  matrix.dshVersion = DSH_VERSION;
  matrix.officialRuntimeSha256 = sha256(runtime);
  const matrixFile = join(root, 'capability-matrix.json');
  writeFileSync(matrixFile, JSON.stringify(matrix, null, 2));

  // 闸门要求 slot / session / workspace 契约都出现在"包文本"里；这里按矩阵原样内联。
  const contractText = JSON.stringify({
    slots: Object.values(matrix.slots).flat(),
    session: Object.values(matrix.session),
    workspace: Object.values(matrix.workspace),
  });

  const sources = {};
  for (const [name, folder] of LOCAL_PACKAGES) {
    const source = join(root, folder, name);
    mkdirSync(join(source, 'lib'), { recursive: true });
    sources[name] = source;
    writeFileSync(join(source, 'package.json'), JSON.stringify({
      name,
      version: '0.2.1',
      main: './lib/index.js',
      exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
      dsh: { client: { platform: 'web', inject: [] } },
      ...(name === 'dsh-fairy-visual' ? { dependencies: { '@deepseek-ai/dsh-settings': DSH_SETTINGS_VERSION } } : {}),
    }, null, 2));
    writeFileSync(join(source, 'lib', 'index.js'), 'export function apply() {}\n');
  }

  // visual 宿主/样式/工具/SVG：内容按闸门逐条断言的契约生成
  const visual = sources['dsh-fairy-visual'];
  mkdirSync(join(visual, 'src', 'client'), { recursive: true });
  const ariaValues = Object.values(matrix.aria).flat();
  const extraAria = ['打开侧边栏', 'Open sidebar', '收起侧边栏', 'Collapse sidebar', '新建会话', 'New session', '发送消息', 'Send message', '选择模型', 'Select model', 'Fairy 朗读控制'];
  writeFileSync(join(visual, 'src', 'client', 'dom-adapter.js'), [
    "'use strict';",
    'const OFFICIAL_SELECTORS = ' + JSON.stringify(matrix.dom, null, 2) + ';',
    'const DOM_ATTRIBUTES = ' + JSON.stringify(matrix.attributes, null, 2) + ';',
    'const ARIA_LABELS = ' + JSON.stringify([...new Set([...ariaValues, ...extraAria])], null, 2) + ';',
    "const DOM_MARKERS = ['data-slot', 'data-composer-card', 'data-input-scroll', 'data-dsh-fairy-composer-dock', 'data-dsh-fairy-visual'];",
    "const ADAPTER_SELECTORS = ['[data-slot=\"sidebar\"]', '[data-slot=\"conversation\"]', '[data-composer-seat]', '[data-composer-card=\"true\"]', '[data-conversation-scroll]', '[data-input-scroll]'];",
    "const ADAPTER_CAPABILITIES = ['modelSelection', 'reasoningControl'];",
    'module.exports = { OFFICIAL_SELECTORS, DOM_ATTRIBUTES, ARIA_LABELS, DOM_MARKERS, ADAPTER_SELECTORS, ADAPTER_CAPABILITIES };',
    '',
  ].join('\n'));
  writeFileSync(join(visual, 'src', 'client', 'utils.js'), [
    "export const MODE_ATTR = 'data-dsh-fairy-theme';",
    'export function deriveSessionComfort(snapshot) { return snapshot?.comforting === true; }',
    'export function deriveSessionActivity(snapshot) {',
    "  if (deriveSessionComfort(snapshot)) return 'comforting';",
    "  return snapshot?.running === true ? 'thinking' : 'normal';",
    '}',
    'export function clearMode(root) { root.removeAttribute(MODE_ATTR); }',
    '',
  ].join('\n'));
  writeFileSync(join(visual, 'src', 'client', 'style.js'), "export const STYLE_ATTRIBUTE = 'data-plugin';\nexport const THEME_ATTRIBUTE = 'data-dsh-fairy-theme';\n");
  writeFileSync(join(visual, 'src', 'index.js'), 'export function settingsNamespace(settingsCtx) { return settingsCtx.settings.register; }\nexport function apply() {}\n');
  const svgTokens = matrix.svg.requiredTokens;
  for (const file of ['visual-transitions.js', 'surface-utils.js', 'composer-material-layer.js']) {
    writeFileSync(join(visual, 'src', 'client', file), '// SVG contract: ' + svgTokens.join(' ') + '\n');
  }
  mkdirSync(join(visual, 'node_modules', '@deepseek-ai', 'dsh-settings'), { recursive: true });
  writeFileSync(join(visual, 'node_modules', '@deepseek-ai', 'dsh-settings', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-settings', version: DSH_SETTINGS_VERSION, main: './lib/index.js' }));

  // 各包的 client 内容
  const voiceSlots = voiceSettingsSlot === 'reviewed'
    ? contractText
    : contractText.replaceAll('settings.section', 'conversation.input.left');
  const clients = {
    'dsh-browser-dock': moduleLoader('dsh-browser-dock') + contractText,
    'dsh-balance-meter': moduleLoader('dsh-balance-meter') + contractText,
    'dsh-fairy-startup': moduleLoader('dsh-fairy-startup') + 'const STARTUP_RESET_ATTR = true;\n' + contractText,
    'dsh-fairy-visual': moduleLoader('dsh-fairy-visual') + "const VISUAL_SLOTS = ['conversation.composer.dock', 'ctx.settingsScope.bind'];\n" + contractText,
    'dsh-fairy-voice': moduleLoader('dsh-fairy-voice') + voiceSlots,
  };
  for (const [name] of LOCAL_PACKAGES) writeFileSync(join(sources[name], 'lib', 'client.js'), clients[name]);

  // ---- 官方 conversation 包（0.2.x 已不再导出 MutableChatNodeStore）----
  const conversation = join(root, 'official', '@deepseek-ai', 'dsh-client-ui-conversation');
  mkdirSync(join(conversation, 'lib'), { recursive: true });
  writeFileSync(join(conversation, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-conversation', version: DSH_VERSION, main: './lib/index.js' }));
  writeFileSync(join(conversation, 'lib', 'index.js'), 'export function apply() {}\n');
  writeFileSync(join(conversation, 'lib', 'client.js'), conversationStore === 'reviewed'
    ? 'var MutableChatNodeStore = class { get(key) { return key; } values() { return []; } };\nconst store = new MutableChatNodeStore();\n' + moduleLoader('@deepseek-ai/dsh-client-ui-conversation')
    : '// 0.2.x：节点存储已并入 dsh-client-store，不再有 MutableChatNodeStore\n' + moduleLoader('@deepseek-ai/dsh-client-ui-conversation'));
  mkdirSync(join(nodeModules, '@deepseek-ai'), { recursive: true });
  symlinkDir(conversation, join(nodeModules, '@deepseek-ai', 'dsh-client-ui-conversation'));

  // ---- reasoning / message-edit 能力包 ----
  const reasoning = join(root, 'dsh-reasoning-effort');
  mkdirSync(join(reasoning, 'lib', 'client'), { recursive: true });
  writeFileSync(join(reasoning, 'package.json'), JSON.stringify({ name: 'dsh-reasoning-effort', version: REASONING_VERSION, main: './lib/index.js', peerDependencies: REASONING_PEERS }, null, 2));
  writeFileSync(join(reasoning, 'lib', 'index.js'), 'export function apply() {}\n');
  writeFileSync(join(reasoning, 'lib', 'client', 'index.js'), moduleLoader('dsh-reasoning-effort') + contractText + "const REASONING_SLOTS = ['conversation.input.model', 'settings.general.item'];\n");
  symlinkDir(reasoning, join(nodeModules, 'dsh-reasoning-effort'));

  const messageEdit = join(root, 'dsh-message-edit');
  mkdirSync(join(messageEdit, 'lib'), { recursive: true });
  writeFileSync(join(messageEdit, 'package.json'), JSON.stringify({ name: 'dsh-message-edit', version: MESSAGE_EDIT_VERSION, main: './lib/index.js' }, null, 2));
  writeFileSync(join(messageEdit, 'lib', 'index.js'), 'export function apply() {}\n');
  writeFileSync(join(messageEdit, 'client.js'), moduleLoader('dsh-message-edit') + contractText + "const MESSAGE_EDIT_SLOTS = ['conversation.view', 'conversation.session.header.actions'];\n");
  symlinkDir(messageEdit, join(nodeModules, 'dsh-message-edit'));

  for (const [name] of LOCAL_PACKAGES) symlinkDir(sources[name], join(nodeModules, name));

  // ---- profile：包声明/锁文件/patch 都取自本仓审查版（显式 profile 根）----
  const reviewedProfile = JSON.parse(readFileSync(join(PROFILE_ROOT, 'package.json'), 'utf8'));
  assert.equal(reviewedProfile.dependencies['dsh-reasoning-effort'], REASONING_SOURCE, '本仓 profile 的 reasoning 声明应与闸门审查值一致');
  assert.ok(reviewedProfile.dsh?.profile?.bundles?.includes('dsh-reasoning-effort'), '本仓 profile bundles 应包含 dsh-reasoning-effort');
  const dependencies = { ...reviewedProfile.dependencies };
  for (const [name, folder] of LOCAL_PACKAGES) dependencies[name] = 'link:' + sources[name];
  const profilePackageFile = join(profile, 'package.json');
  writeFileSync(profilePackageFile, JSON.stringify({ name: reviewedProfile.name, private: true, dependencies, dsh: reviewedProfile.dsh }, null, 2));
  copyFileSync(join(PROFILE_ROOT, 'pnpm-lock.yaml'), join(profile, 'pnpm-lock.yaml'));
  copyFileSync(join(PROFILE_ROOT, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml'));

  // 闸门的 main() 会无条件 realpath 它自己的 homedir 默认 profile/runtime（即使显式传了
  // --profile/--runtime）。真实 home 里 0.2.x 已没有 dsh-client-runtime，所以候选用例统一
  // 把子进程 USERPROFILE/HOME 指到这个 scratch home：默认值存在但**不等于候选**，
  // 于是『拒绝校验现役对象』的守卫不会误伤，闸门也能走到真正的契约校验。
  const runHome = join(root, 'run-home');
  mkdirSync(join(runHome, '.dsh', 'profiles', 'web'), { recursive: true });
  const unrelatedRuntime = join(runHome, '.local', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js');
  mkdirSync(dirname(unrelatedRuntime), { recursive: true });
  writeFileSync(unrelatedRuntime, '// 与本候选无关的现役运行时占位\n');
  const env = { USERPROFILE: runHome, HOME: runHome };
  return { root, profile, runtime, matrixFile, matrix, profilePackageFile, version: DSH_VERSION, hash: matrix.officialRuntimeSha256, env };
}

function createFakeHome(fixture) {
  const fakeHome = join(fixture.root, 'home');
  const defaultProfile = join(fakeHome, '.dsh', 'profiles', 'web');
  mkdirSync(join(fakeHome, '.dsh', 'profiles'), { recursive: true });
  symlinkDir(fixture.profile, defaultProfile);
  // 闸门把"官方运行时"硬编码为 homedir()/.local/.../dsh-client-runtime/lib/client.js。
  // 0.2.x 上游已把这个包改名 dsh-client-modules，这里如实复现闸门探测的旧路径，
  // 让"拒绝对现役运行时做候选校验"这条守卫在测试里可达。
  const legacyRuntime = join(fakeHome, '.local', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js');
  mkdirSync(dirname(legacyRuntime), { recursive: true });
  copyFileSync(fixture.runtime, legacyRuntime);
  return { fakeHome, defaultProfile, legacyRuntime };
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_CAPABILITY_MATRIX: options.matrixFile,
      ...(options.env || {}),
    },
  });
}

// 候选用例统一带 scratch home（见 createFixture 里的说明）。
function runCandidate(fixture, args, matrixFile = fixture.matrixFile) {
  return run(args, { matrixFile, env: fixture.env });
}

function reviewedArgs(fixture) {
  return ['--profile', fixture.profile, '--runtime', fixture.runtime, '--expected-version', fixture.version, '--expected-sha256', fixture.hash];
}

test('refuses to validate the active profile or official runtime by default', (t) => {
  // 原来：把本机 ~/.dsh/profiles/web 当"现役 profile"传进去，指望闸门拒绝。
  // 现在：闸门的"现役"判定基于 homedir()，所以把子进程的 USERPROFILE/HOME 指到临时
  // home，并在其中放出 .dsh/profiles/web 与被探测的旧 dsh-client-runtime 路径，
  // 从而在不碰用户真实 home 的前提下真正走到这两条守卫。
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const { fakeHome, legacyRuntime } = createFakeHome(fixture);
  const env = { USERPROFILE: fakeHome, HOME: fakeHome, DSH_CAPABILITY_MATRIX: fixture.matrixFile };

  const activeProfile = run(reviewedArgs(fixture), { matrixFile: fixture.matrixFile, env });
  assert.notEqual(activeProfile.status, 0);
  assert.match(activeProfile.stderr, /isolated profile/);

  const elsewhere = join(fixture.root, 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  const activeRuntime = run([
    '--profile', elsewhere,
    '--runtime', legacyRuntime,
    '--expected-version', fixture.version,
    '--expected-sha256', fixture.hash,
  ], { matrixFile: fixture.matrixFile, env });
  assert.notEqual(activeRuntime.status, 0);
  assert.match(activeRuntime.stderr, /isolated runtime/);
});

test('reports the reviewed dependency matrix without writing the active profile', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const before = readFileSync(fixture.profilePackageFile, 'utf8');
  const result = run(['--report', '--profile', fixture.profile, '--runtime', fixture.runtime], { matrixFile: fixture.matrixFile });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DSH upgrade compatibility matrix/);
  // 原来钉的是 0.1.1-rc.2 时代的 dsh-reasoning-effort 0.6.2；现在闸门审查值已迁到 0.8.1。
  assert.match(result.stdout, /@deepseek-ai\/dsh-settings 0\.1\.1-rc\.2/);
  assert.match(result.stdout, /dsh-reasoning-effort: 0\.8\.1/);
  assert.match(result.stdout, /dsh-message-edit: 0\.2\.3/);
  assert.match(result.stdout, /MutableChatNodeStore; node kinds user\/assistant-step; Visual activity normal\/thinking\/comforting/);
  assert.match(result.stdout, /Known review risks/);
  assert.equal(readFileSync(fixture.profilePackageFile, 'utf8'), before);
});

test('validates an isolated candidate profile without writing into it', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const before = readFileSync(fixture.profilePackageFile, 'utf8');
  const result = runCandidate(fixture, reviewedArgs(fixture));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DSH upgrade preflight verified/);
  // 版本/哈希不再是 0.1.1-rc.2 + 13a5fe0e…，而是夹具现场声明的 0.2.1-rc.2 + 实测 sha256。
  assert.match(result.stdout, new RegExp('runtime ' + fixture.version.replace(/\./g, '\\.')));
  assert.equal(readFileSync(fixture.profilePackageFile, 'utf8'), before);
});

test('fails closed on an unapproved runtime hash', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const result = runCandidate(fixture, [
    '--profile', fixture.profile,
    '--runtime', fixture.runtime,
    '--expected-version', fixture.version,
    '--expected-sha256', '0'.repeat(64),
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime SHA-256 mismatch/);
});

test('fails closed when the reasoning lock pin changes', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const lockFile = join(fixture.profile, 'pnpm-lock.yaml');
  const driftedLock = readFileSync(lockFile, 'utf8').replaceAll(REASONING_COMMIT, '0'.repeat(40));
  assert(!driftedLock.includes(REASONING_COMMIT), '夹具必须替换掉所有 reasoning 锁 pin');
  writeFileSync(lockFile, driftedLock);
  const result = runCandidate(fixture, reviewedArgs(fixture));
  assert.notEqual(result.status, 0);
  // 原断言的措辞是 "reasoning-effort lock source or local patch drifted"，与闸门实际文案不符；
  // 改成闸门真正会打印的那一条，避免断言恒真/恒假。
  assert.match(result.stderr, /reasoning-effort lock source drifted/);
});

test('fails closed when the reviewed assistant node kind drifts', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const drifted = { ...fixture.matrix, conversationProjection: { ...fixture.matrix.conversationProjection, nodeKinds: { ...fixture.matrix.conversationProjection.nodeKinds, assistant: 'assistant' } } };
  const matrixFile = join(fixture.root, 'capability-matrix-drifted.json');
  writeFileSync(matrixFile, JSON.stringify(drifted, null, 2));
  const result = runCandidate(fixture, reviewedArgs(fixture), matrixFile);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conversation node kinds drifted/);
});

test('fails closed when Visual activity stops using the session running authority', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const drifted = { ...fixture.matrix, conversationProjection: { ...fixture.matrix.conversationProjection, visualActivity: { ...fixture.matrix.conversationProjection.visualActivity, authority: 'chat.nodes' } } };
  const matrixFile = join(fixture.root, 'capability-matrix-drifted.json');
  writeFileSync(matrixFile, JSON.stringify(drifted, null, 2));
  const result = runCandidate(fixture, reviewedArgs(fixture), matrixFile);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Visual activity projection drifted/);
});

/*
 * 以下三条断言"当前闸门实际会怎么做"：0.2.x 上游已经不存在这些概念，
 * 闸门会按 fail closed 打印对应文案 —— 这正是升级前必须先复评闸门的原因。
 */
test('fails closed when the 0.2.x runtime bundle drops the reviewed lifecycle hooks', (t) => {
  const fixture = createFixture({ runtimeLifecycle: 'current-0-2-x' });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const result = runCandidate(fixture, reviewedArgs(fixture));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ClientModuleRegistry lifecycle behavior is missing/);
});

test('fails closed when the 0.2.x conversation bundle drops MutableChatNodeStore', (t) => {
  const fixture = createFixture({ conversationStore: 'current-0-2-x' });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const result = runCandidate(fixture, reviewedArgs(fixture));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /official conversation Session Store implementation drifted/);
});

test('fails closed when the 0.2.x voice package stops declaring the settings.section slot', (t) => {
  const fixture = createFixture({ voiceSettingsSlot: 'current-0-2-x' });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const result = runCandidate(fixture, reviewedArgs(fixture));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /voice slot contract is missing/);
});