# Fairy-DSH 设置栏合并 + 朗读服务检测
#
# 目标（0.2.0 起）：
#   * 设置里只保留**一个** Fairy 入口（fairy-visual 的 settings.section）
#   * 该入口内追加「朗读服务」区块：检测失败时显示醒目红色警告
#   * 语音简报的 API Key 表单也一并搬进来，所以不再需要第二个设置入口
#   * 保留上游 GPT-SoVITS 朗读路线（engine='fairy'）为默认；
#     [local patch 0.3.2] 新增可切换的第二条路线 MOSS-TTS-Nano（engine='moss-nano'，CPU 可跑）
#
# 本文件只定义函数，不要写 exit / 顶层副作用（会被 install.ps1 dot-source）。

$script:MergeUtf8 = New-Object System.Text.UTF8Encoding($false)
$script:MergeMarker = 'dsh-fairy-voice-panel'   # 面板标记（用于识别状态）

function Get-SettingsMergeState {
  param([Parameter(Mandatory)][string]$Root)
  $voice  = Join-Path $Root 'fairy-voice\dsh-fairy-voice\lib\client.js'
  $visual = Join-Path $Root 'fairy-visual\dsh-fairy-visual\lib\client.js'
  if (-not (Test-Path -LiteralPath $voice) -or -not (Test-Path -LiteralPath $visual)) { return 'missing' }
  $vt = [System.IO.File]::ReadAllText($voice, $script:MergeUtf8)
  $pt = [System.IO.File]::ReadAllText($visual, $script:MergeUtf8)
  $voiceHasSection = $vt.Contains("'settings.section', { id: 'fairy-voice-brain'")
  $visualHasPanel  = $pt.Contains($script:MergeMarker)
  if ($visualHasPanel -and -not $voiceHasSection) { return 'merged' }
  if (-not $visualHasPanel -and $voiceHasSection) { return 'upstream' }
  return 'mixed'
}

# 视觉包：在 Settings 组件前插入面板组件，并让 settings.section 同时渲染两者
function New-MergedVisualText {
  param([Parameter(Mandatory)][string]$Root)
  $pristine = Join-Path $Root 'upstream-originals\fairy-visual-client.js'
  if (-not (Test-Path -LiteralPath $pristine)) { throw "找不到上游原件：$pristine" }
  $text = [System.IO.File]::ReadAllText($pristine, $script:MergeUtf8)

  $panel = @'
    // [local patch 0.2.2] 设置栏顶部声明行（版本 / 打包时间 / 来源 / 群号）
    function FairyNotice() {
      return jsx('div', {
        className: 'dsh-fairy-notice',
        'data-dsh-fairy-notice': 'true',
        style: { fontSize: '11px', lineHeight: 1.6, opacity: 0.55, marginBottom: '12px' },
        children: '__FAIRY_NOTICE__'
      });
    }
    // [local patch 0.2.3] 自检面板：面向完全不懂技术的使用者，每一项都给"怎么修"
    /* [local patch 0.3.6 · T-128] 朗读服务清单。
     * ★ 前提：拿到本包的人【默认一台 TTS 都没装】。所以四条路必须平铺出来，
     *   让使用者按「有没有显卡 / 愿不愿意装 / 有没有 Key」自己挑，
     *   而不是一上来就假定本机跑着 GPT-SoVITS。
     * key 与服务端 providers 分区的键一致（sovits / moss / openai / customHttp）。
     * 本地两条路的「服务地址」仍走既有的 ttsUrl 字段，所以 fields 留空。 */
    const PROVIDER_OPTIONS = [
      { id: 'gpt-sovits', key: 'sovits', label: 'GPT-SoVITS（本地 · 默认）', summary: '音色最好；要显卡，得自己跑一个 Python 服务（6-9 GB）', fields: [] },
      { id: 'moss-nano', key: 'moss', label: 'MOSS-TTS-Nano（本地 · CPU 也能跑）', summary: '一条命令装好（4-5 GB）；整句合成完才出声，约 7 秒', fields: [] },
      { id: 'openai', key: 'openai', label: 'OpenAI 兼容云端 TTS', summary: '不用自己装，联网即用；要自备 API Key', fields: [
        { key: 'baseURL', label: '接口地址', placeholder: 'https://api.openai.com/v1' },
        { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', secret: true },
        { key: 'model', label: '模型', placeholder: 'gpt-4o-mini-tts' },
        { key: 'voice', label: '音色', placeholder: 'alloy' },
        { key: 'responseFormat', label: '返回格式', placeholder: 'wav' }
      ] },
      { id: 'custom-http', key: 'customHttp', label: '自定义 HTTP 接口', summary: '接你自己的 TTS 服务，请求体用模板自己拼', fields: [
        { key: 'url', label: '接口地址', placeholder: 'http://127.0.0.1:5000/tts' },
        { key: 'method', label: '请求方法', placeholder: 'POST' },
        { key: 'headersJson', label: '请求头（JSON）', placeholder: '{"Content-Type":"application/json"}' },
        { key: 'bodyTemplate', label: '请求体模板（{{text}} 会被替换成要念的文本）', placeholder: '{"text":"{{text}}"}' }
      ] }
    ];
    const providerOption = (id) => PROVIDER_OPTIONS.find((item) => item.id === id) || PROVIDER_OPTIONS[0];
    function FairyVoicePanel() {
      const [selfcheck, setSelfcheck] = React.useState({ running: true, ok: false, headline: '正在自检…', checks: [] });
      // [local patch 0.3.2] engine = 当前朗读引擎；sovitsBase/mossBase = 两个引擎各自记住的地址（切换不丢）
      /* [local patch 0.3.4] saved* 三个字段是「服务端已保存的值」的快照，
       * 用来判断表单有没有未保存的改动（见下面的 isConfigDirty）。
       * 放在 state 里而不是 ref 里：保存后 loadConfig() 会重刷快照，
       * 于是 dirty 自动归零，不需要在 saveConfig 里额外挂钩子。 */
      const [configForm, setConfigForm] = React.useState({ engine: 'gpt-sovits', ttsUrl: '', sovitsBase: '', mossBase: '', referenceAudioPath: '', defaultBase: '', defaultSovitsBase: '', defaultMossBase: '', defaultReferenceAudioPath: '', savedEngine: 'gpt-sovits', savedTtsUrl: '', savedReferenceAudioPath: '', providers: {}, savedProviders: '{}', configured: true, loaded: false, saving: false, message: '', error: false });
      const [diagText, setDiagText] = React.useState('');
      const [copyState, setCopyState] = React.useState('');
      // [local patch 0.3.2] 自检明细默认折叠。
      // 原因：设置在前、自检在后，「看结果」不该挡住「改配置」；折叠后设置区永远在最上面。
      // 注意：折叠的只是【明细】，结论那一行（✅/❌）始终可见，不用展开就知道好没好。
      const [selfcheckOpen, setSelfcheckOpen] = React.useState(false);
      /* [local patch 0.2.3 起有，0.3.2 移除] 原来是「首次使用大红框 + 我知道了，不再提示」。
       * 那个框把 ①人设 和 ②语音 合在一起放在面板最上面，和下面各区块自己的状态重复，
       * 而且逼着使用者去点一次"不再提示"。现在待办拆进各区块里（静态状态，不弹不打扰），
       * 所以 localStorage 的 dsh.fairy.onboarded.v1 和那两个状态一起退休了。 */
      const [tick, setTick] = React.useState(0);
      const [brain, setBrain] = React.useState({ configured: false, text: '正在读取语音简报配置…', error: false });
      const [apiKey, setApiKey] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      // [local patch 0.2.1] Fairy 人设预设开关（真正的安装/移除由宿主路由负责）
      // [local patch 0.2.3] 再加「一键设为默认预设」：使用者不必自己去找那个设置项
      const [persona, setPersona] = React.useState({ installed: false, available: false, busy: false, error: '', defaultPreset: '', isDefault: false, defaultReadable: false, previousDefault: '' });
      const applyPersona = (value) => setPersona({
        installed: value && value.installed === true,
        available: value && value.available === true,
        busy: false,
        error: '',
        defaultPreset: String((value && value.defaultPreset) || ''),
        isDefault: value && value.isDefault === true,
        defaultReadable: value && value.defaultReadable === true,
        previousDefault: String((value && value.previousDefault) || '')
      });
      const loadPersona = React.useCallback(() => {
        fetch('/fairy-persona/status', { cache: 'no-store' })
          .then((response) => {
            if (response.status === 404) throw new Error('宿主路由未注册：请重启 DSH 后再试（宿主侧尚未加载本功能）');
            if (!response.ok) throw new Error('宿主返回 HTTP ' + response.status);
            return response.json();
          })
          .then(applyPersona)
          .catch((error) => setPersona((prev) => ({ ...prev, busy: false, error: (error && error.message) || '无法访问宿主路由 /fairy-persona/status' })));
      }, []);
      const postPersona = React.useCallback((path, payload, fallbackMessage) => {
        setPersona((prev) => ({ ...prev, busy: true, error: '' }));
        fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then((response) => response.json().then((value) => ({ ok: response.ok, value })))
          .then(({ ok, value }) => {
            if (!ok) throw new Error((value && value.error && (value.error.message || value.error.code)) || fallbackMessage);
            applyPersona(value);
          })
          .catch((error) => setPersona((prev) => ({ ...prev, busy: false, error: (error && error.message) || fallbackMessage })));
      }, []);
      const togglePersona = React.useCallback(
        () => postPersona('/fairy-persona/toggle', { enabled: !persona.installed }, '切换失败'),
        [persona.installed, postPersona]
      );
      const toggleDefaultPreset = React.useCallback(
        () => postPersona('/fairy-persona/default', { enabled: !persona.isDefault }, '设置默认预设失败'),
        [persona.isDefault, postPersona]
      );
      // [local patch 0.2.3] 客户端侧检查：只有浏览器才知道的事，宿主查不到
      const clientChecks = React.useMemo(() => {
        const list = [];
        const diag = (typeof window !== 'undefined' && window.__FAIRY_VOICE_DIAG__) || null;
        const hasAudio = typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
        // 朗读控件挂在 HDD 视觉模式的槽位上：视觉模式不开，朗读按钮压根不会出现
        const visualOn = typeof document !== 'undefined'
          && (document.documentElement.hasAttribute('data-dsh-fairy-visual') || document.documentElement.getAttribute('data-dsh-fairy-mode') === 'hdd');
        list.push(visualOn
          ? { id: 'visual-mode', title: 'HDD 视觉模式（朗读的前提）', level: 'ok', detail: 'H.D.D 视觉模式已开启 —— 朗读控件只在它开启时出现。', fix: '' }
          : { id: 'visual-mode', title: 'HDD 视觉模式（朗读的前提）', level: 'fail', detail: 'H.D.D 视觉模式没开：朗读按钮和自动朗读开关都不会出现（这是上游插件的设计，不是坏了）。', fix: '到 设置 → Fairy 最上面把「启用」打开，然后回到会话页面刷新一次（Ctrl+F5）。' });
        list.push(hasAudio
          ? { id: 'browser-audio', title: '浏览器音频播放能力', level: 'ok', detail: '这台浏览器支持 Web Audio，能播放朗读音频。', fix: '' }
          : { id: 'browser-audio', title: '浏览器音频播放能力', level: 'fail', detail: '这台浏览器不支持 Web Audio，朗读没办法出声。', fix: '换用新版 Chrome / Edge 等 Chromium 内核浏览器，并关掉可能禁用音频的扩展。' });
        if (!diag || diag.mounted !== true) {
          list.push({
            id: 'client-mounted', title: '朗读控件是否挂上', level: 'fail',
            detail: '页面里没发现朗读控件——客户端脚本没有跑起来（可能插件没装好，或者页面还是旧的缓存）。',
            fix: '先重启 DSH，然后在本页按 Ctrl+F5 强制刷新；仍然这样，请点下面「复制诊断信息」并提交到本仓库 Issues。'
          });
        } else {
          list.push({ id: 'client-mounted', title: '朗读控件是否挂上', level: 'ok', detail: `朗读控件已挂上（页面加载于 ${new Date(diag.mountedAt || Date.now()).toLocaleTimeString()}）。`, fix: '' });
          if (diag.timelineRead !== true) {
            // 还没进过任何会话，插件压根没读到过消息——这不能算失败，只能算"还没测"。
            list.push({
              id: 'message', title: '消息识别（能不能读到要朗读的内容）', level: 'warn',
              detail: '插件已挂上，但这次还没有打开过任何会话，所以暂时读不到消息。这一项要等你在会话里看过回复之后才准。',
              fix: '回到会话页面（新建一个会话，或打开已有的），随便问一句并等回复跑完，再回设置里点「重新自检」。'
            });
          } else if (!diag.chatSource && !diag.structure) {
            /* [local patch 0.3.5] 页面上的朗读客户端是 0.3.1 之前的旧包。
             * 那版只会读 snapshot.chat（DSH 早就不给这个字段）→ 必然读不到消息。
             * 判据：chatSource / structure 都是 0.3.1 加的，且【每次读时间线都会写】，
             * 两个都缺说明跑的压根不是新代码 —— 让使用者重启 + Ctrl+F5，别去查 DSH。 */
            list.push({
              id: 'message', title: '消息识别（能不能读到要朗读的内容）', level: 'fail',
              detail: '读不到消息：你页面里的朗读客户端是【旧版本】（诊断信息里缺 chatSource / structure 这两个新字段）。这不是 DSH 的问题，也不是操作失误 —— 更新插件之后，页面还在跑旧脚本。',
              fix: '先重启 DSH，然后在本页按 Ctrl+F5 强制刷新，再回来看这一项。要是还这样，说明 dsh-fairy-voice 这个包本身没更新到最新（设置页顶部那个版本号来自视觉包，代表不了它），请重新装一次。'
            });
          } else if (diag.hasChat !== true) {
            list.push({
              id: 'message', title: '消息识别（能不能读到要朗读的内容）', level: 'fail',
              detail: `插件读不到会话的消息结构——这属于插件和当前 DSH 版本的适配问题，不是操作失误。技术细节：快照字段=[${(diag.snapshotKeys || []).join(', ')}]，chat 字段=[${(diag.chatKeys || []).join(', ')}]。本页最底部「结构摘要」里有完整的字段清单。`,
              fix: '这一项只能由插件作者修。请点「复制诊断信息」并提交到本仓库 Issues，作者据此适配。'
            });
          } else if ((diag.finalCount || 0) === 0) {
            list.push({
              id: 'message', title: '消息识别（能不能读到要朗读的内容）', level: 'warn',
              detail: `能读到会话结构（消息 ${diag.orderLength} 条、回合 ${diag.turnCount} 个），但当前还没有"已完成的回复"可以朗读。`,
              fix: '先在会话里正常问一句、等回复跑完，再回来点「重新自检」。如果明明有回复却一直是 0，请把诊断信息提交到本仓库 Issues。'
            });
          } else {
            list.push({ id: 'message', title: '消息识别（能不能读到要朗读的内容）', level: 'ok', detail: `已能读到消息：当前会话有 ${diag.finalCount} 条可朗读的回复。`, fix: '' });
          }
        }
        return list;
      }, [tick]);
      // 自检结果刷新用：设置页打开期间每 3 秒重算一次客户端检查
      React.useEffect(() => {
        const timer = setInterval(() => setTick((value) => value + 1), 3000);
        return () => clearInterval(timer);
      }, []);
      /* [local patch 0.3.2] 让自检拿到「最新的表单值」。
       * runSelfCheck 是 useCallback([])，直接闭包会读到旧值，所以用 ref 取最新。
       * 目的：引擎切成 MOSS 后【不保存也能直接测 MOSS】—— 宿主只做临时覆盖，不写磁盘。 */
      const configFormRef = React.useRef(configForm);
      React.useEffect(() => { configFormRef.current = configForm; }, [configForm]);
      const runSelfCheck = React.useCallback(() => {
        setSelfcheck((prev) => ({ ...prev, running: true, headline: '正在自检：会真的合成一句话，通常几秒内完成…' }));
        // 表单还没加载完就不带参数，用磁盘上已保存的配置（打开面板时的首次自动自检走这条）。
        const form = configFormRef.current;
        let query = '';
        if (form && form.loaded) {
          const params = new URLSearchParams();
          params.set('engine', form.engine);
          /* [local patch 0.3.6] base / ref 只对本地两条路有意义：云端服务认的是 Key、
           * 模型这些分区字段，拿本地地址去覆盖会测错对象。 */
          if (form.engine === 'gpt-sovits' || form.engine === 'moss-nano') {
            params.set('base', String(form.ttsUrl || '').trim());
            params.set('ref', String(form.referenceAudioPath || '').trim());
          }
          query = `?${params.toString()}`;
        }
        fetch(`/fairy-voice/selfcheck${query}`, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : {
            ok: false,
            headline: `插件宿主没有响应（HTTP ${response.status}）：插件可能没加载，先重启 DSH 再试。`,
            checks: []
          }))
          .then((value) => setSelfcheck({
            running: false,
            ok: Boolean(value && value.ok === true),
            headline: String((value && value.headline) || '自检没有返回结果。'),
            checks: Array.isArray(value && value.checks) ? value.checks : []
          }))
          .catch(() => setSelfcheck({
            running: false, ok: false,
            headline: '连不上插件宿主：dsh-fairy-voice 可能没有安装，或者 DSH 需要重启。',
            checks: []
          }));
      }, []);
      const loadConfig = React.useCallback(() => {
        fetch('/fairy-voice/config', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((value) => {
            if (!value) return;
            setConfigForm((prev) => ({
              ...prev,
              // [local patch 0.3.2] 引擎与两个地址：base 是当前引擎的，sovitsBase/mossBase 各自留一份
              engine: PROVIDER_OPTIONS.some((item) => item.id === value.engine) ? value.engine : 'gpt-sovits',
              ttsUrl: String(value.base || ''),
              sovitsBase: String(value.sovitsBase || ''),
              mossBase: String(value.mossBase || ''),
              referenceAudioPath: String(value.referenceAudioPath || ''),
              defaultBase: String(value.defaultBase || ''),
              defaultSovitsBase: String(value.defaultSovitsBase || ''),
              defaultMossBase: String(value.defaultMossBase || ''),
              defaultReferenceAudioPath: String(value.defaultReferenceAudioPath || ''),
              // [local patch 0.3.4] 同时刷新「已保存」快照，dirty 状态随之归零
              savedEngine: PROVIDER_OPTIONS.some((item) => item.id === value.engine) ? value.engine : 'gpt-sovits',
              savedTtsUrl: String(value.base || ''),
              savedReferenceAudioPath: String(value.referenceAudioPath || ''),
              /* [local patch 0.3.6] 分区配置的草稿与快照。服务端每个分区里带的 key 字段
               * 只是给 UI 认人的，写回去之前先剥掉，免得污染配置文件。 */
              providers: Object.fromEntries(Object.entries((value.providers && typeof value.providers === 'object') ? value.providers : {}).map(([sectionKey, section]) => {
                const { key, ...rest } = section || {};
                return [sectionKey, rest];
              })),
              savedProviders: JSON.stringify(Object.fromEntries(Object.entries((value.providers && typeof value.providers === 'object') ? value.providers : {}).map(([sectionKey, section]) => {
                const { key, ...rest } = section || {};
                return [sectionKey, rest];
              }))),
              configured: value.configured === true,
              loaded: true
            }));
          })
          .catch(() => {});
      }, []);
      const saveConfig = React.useCallback(async (payload) => {
        setConfigForm((prev) => ({ ...prev, saving: true, message: '', error: false }));
        try {
          const response = await fetch('/fairy-voice/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          });
          const value = await response.json().catch(() => null);
          if (!response.ok) throw new Error((value && value.error && value.error.message) || `保存失败（HTTP ${response.status}）`);
          setConfigForm((prev) => ({ ...prev, saving: false, message: '已保存，正在用新设置重新自检…', error: false }));
          loadConfig();
          runSelfCheck();
        } catch (error) {
          setConfigForm((prev) => ({ ...prev, saving: false, message: (error && error.message) || '保存失败。', error: true }));
        }
      }, [loadConfig, runSelfCheck]);
      const allChecks = selfcheck.checks.concat(clientChecks);
      // [local patch 0.3.2] 当前引擎：决定「地址」那一栏叫什么、占位符是什么
      const isMossEngine = configForm.engine === 'moss-nano';
      /* [local patch 0.3.6] 当前服务：key 用于读 providers 分区，isLocalProvider 决定
       * 「服务地址 / 参考音频」这两栏要不要显示（云端服务用不上参考音频）。 */
      const currentKey = providerOption(configForm.engine).key;
      const isLocalProvider = currentKey === 'sovits' || currentKey === 'moss';
      const cloudFields = providerOption(configForm.engine).fields;
      /* [local patch 0.3.4] 选中引擎的唯一入口 —— 上面的下拉框和下面的两个引擎卡片都走这里，
       * 保证两条路行为完全一致（都只改表单、不立即保存；都跟着把地址框换成该引擎自己的地址）。 */
      const selectEngine = React.useCallback((next) => {
        const key = providerOption(next).key;
        setConfigForm((prev) => ({
          ...prev,
          engine: next,
          /* 云端服务没有「服务地址」这一栏，ttsUrl 保持原样不动；
           * 只有本地两条路才各自取回自己记着的那份地址。 */
          ttsUrl: key === 'moss'
            ? (prev.mossBase || prev.defaultMossBase || '')
            : key === 'sovits'
              ? (prev.sovitsBase || prev.defaultSovitsBase || prev.defaultBase || '')
              : prev.ttsUrl
        }));
      }, []);
      /* [local patch 0.3.6] 保存载荷：本地两条路仍走旧的 engine / base / referenceAudioPath，
       * 云端两条路额外带上 providers 分区（Key / 模型 / 音色 / 自定义模板）。 */
      const savePayload = React.useCallback(() => {
        const key = currentKey;
        const section = configForm.providers[key] || {};
        return {
          provider: configForm.engine,
          engine: configForm.engine,
          ...(isLocalProvider ? { base: configForm.ttsUrl.trim(), referenceAudioPath: configForm.referenceAudioPath.trim() } : {}),
          ...(Object.keys(section).length > 0 ? { providers: { [key]: section } } : {}),
        };
      }, [configForm, currentKey, isLocalProvider]);
      /* [local patch 0.3.4] 「改动过、但还没保存」。
       * 只比这三个真正影响朗读的字段；default* 是占位符提示，不参与比较。
       * loadConfig 在加载成功和保存成功后都会跑，所以保存完这里会自动回到 false。 */
      const isConfigDirty = configForm.loaded === true && (
        configForm.engine !== configForm.savedEngine
        || String(configForm.ttsUrl || '').trim() !== String(configForm.savedTtsUrl || '').trim()
        || String(configForm.referenceAudioPath || '').trim() !== String(configForm.savedReferenceAudioPath || '').trim()
        || JSON.stringify(configForm.providers || {}) !== String(configForm.savedProviders || '{}')
      );
      const failedChecks = allChecks.filter((check) => check.level === 'fail');
      const ready = failedChecks.length === 0 && selfcheck.running === false;
      // [local patch 0.3.2] 人设这条待办显示在「人设预设」区块里（面板顶部的大红框已拆掉）
      const personaTodo = persona.installed !== true || persona.isDefault !== true;
      /* [local patch 0.3.2] 原来这里有一个「⚠ 还有必做的事没完成」的大红框，把 ①人设 和 ②语音
       * 合在一起列在面板最上面。它和下面各区块自己的状态重复，看着多余 —— 现在拆掉了：
       *   ① 人设 那条 → 留在「Fairy 人设预设」区块里（见那边的 personaTodo 红字子条目）
       *   ② 语音 那条 → 留在「朗读自检」的结论行（❌ 时本来就会写清「还有 N 项没过」+ 怎么修）
       * 这样每条待办只出现在它该出现的地方，也不用再让人点一次「不再提示」。 */
      const copyDiagnostics = React.useCallback(() => {
        const lines = [];
        lines.push(`Fairy-DSH 语音自检结果（${new Date().toLocaleString()}）`);
        lines.push(`结论：${selfcheck.headline}`);
        lines.push(`朗读引擎：${configForm.engine === 'moss-nano' ? 'MOSS-TTS-Nano' : 'GPT-SoVITS'}`);
        lines.push(`${configForm.engine === 'moss-nano' ? 'MOSS' : 'SoVITS'} 地址：${configForm.ttsUrl || '（未读取到）'}`);
        lines.push(`参考音频：${configForm.referenceAudioPath || '（未读取到）'}`);
        for (const check of allChecks) {
          lines.push(`[${check.level}] ${check.title}：${check.detail}${check.fix ? `  → 怎么修：${check.fix}` : ''}`);
        }
        const diag = (typeof window !== 'undefined' && window.__FAIRY_VOICE_DIAG__) || null;
        lines.push(`客户端诊断：${diag ? JSON.stringify(diag) : '（页面里没有诊断数据）'}`);
        /* [local patch 0.3.5] 把「结构摘要」一起复制进去 ——
         * 以前它在下另一个框里，要复制两次、发出去是一大一小两段，看着乱还容易漏。
         * 这里用 readShapeText() 现算：面板上那个只读框已经删了，且它读的是
         * window.__FAIRY_VOICE_DIAG__ 的当下值，所以闭包旧了也不影响结果。 */
        /* [local patch 0.3.5] 结构摘要改成现算：面板上那个文本框已删。
         * readShapeText 读的是 window.__FAIRY_VOICE_DIAG__ 的当下值，所以闭包旧了也不影响结果。 */
        const shapeValue = readShapeText();
        if (shapeValue) {
          lines.push('');
          lines.push('---- 结构摘要（只有字段名与类型，不含任何取值）----');
          lines.push(shapeValue);
        }
        const text = lines.join('\n');
        setDiagText(text);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              () => setCopyState('已复制，直接粘贴到群里就行。'),
              () => setCopyState('自动复制被浏览器拦了，请手动选中下面的文字复制。')
            );
          } else {
            setCopyState('这个浏览器不支持自动复制，请手动选中下面的文字复制。');
          }
        } catch (error) {
          setCopyState('自动复制失败，请手动选中下面的文字复制。');
        }
      }, [selfcheck, configForm, allChecks]);
      /* [local patch 0.3.2] 一键复制「让 Agent 去装 MOSS」的说明。
       * 为什么不放一个要手动全选的文本框：同一个面板上已经有「复制诊断信息」按钮了，
       * 按钮 + 剪贴板是这套 UI 的既有做法，文本框要用户自己选、自己复制，是退步。 */
      const copyInstallGuide = React.useCallback(() => {
        const docUrl = 'docs/install-moss.md（就在本仓库根目录，直接打开这个文件）';
        const text = [
          '请帮我在这台电脑上安装 MOSS-TTS-Nano，作为 DSH 里 Fairy 朗读的第二个引擎。',
          '',
          `安装说明（请先完整读一遍再动手）：${docUrl}`,
          '',
          '要求：',
          '1. 全程照那份文档做，不要自己发挥；文档里标了「🛑 停下问人」的地方，就停下来问我。',
          '2. 不要改动我 ~/.dsh 里已有的任何文件，尤其不要动 profiles/ 目录。',
          '3. 装完请自己验证一遍：服务能起来、/health 正常、并且真的能合成出一句话。',
          '4. 最后告诉我：以后怎么启动这个服务，以及我需要在 DSH 的「设置 → Fairy → 朗读设置」里做什么。'
        ].join('\n');
        setDiagText(text);
        setCopyState('');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              () => setCopyState('安装说明已复制 —— 直接粘贴给你的 AI Agent 就行。'),
              () => setCopyState('自动复制被浏览器拦了，请手动选中下面的文字复制。')
            );
          } else {
            setCopyState('这个浏览器不支持自动复制，请手动选中下面的文字复制。');
          }
        } catch (error) {
          setCopyState('自动复制失败，请手动选中下面的文字复制。');
        }
      }, []);
      const loadBrain = React.useCallback(() => {
        fetch('/fairy-voice/brain/status', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : { configured: false }))
          .then((value) => setBrain({
            configured: Boolean(value && value.configured === true),
            text: value && value.configured === true ? '已配置。密钥保存在本机，不会在页面回显。' : '未配置。未配置时，长回答会直接使用原文朗读。',
            error: false
          }))
          .catch(() => setBrain({ configured: false, text: '暂时无法读取本地配置状态。', error: true }));
      }, []);
      React.useEffect(() => { runSelfCheck(); loadConfig(); loadBrain(); loadPersona(); }, [runSelfCheck, loadConfig, loadBrain, loadPersona]);
      const postConfig = async (payload) => {
        setBusy(true);
        try {
          const response = await fetch('/fairy-voice/brain/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          });
          if (!response.ok) throw new Error('请求失败（' + response.status + '）');
          setBrain({
            configured: payload.clear !== true,
            text: payload.clear === true ? '已移除。未配置时不会调用云端模型。' : '已配置。密钥保存在本机，不会在页面回显。',
            error: false
          });
          setApiKey('');
        } catch (error) {
          setBrain({ configured: false, text: (error && error.message) || '保存失败。', error: true });
        } finally { setBusy(false); }
      };
      const rowStyle = { fontSize: '12px', lineHeight: 1.7, opacity: 0.85 };
      const inputStyle = {
        width: '100%', height: '32px', padding: '0 10px', boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-0, transparent)', color: 'inherit',
        font: '12px ui-monospace, SFMono-Regular, Menlo, monospace'
      };
      const checkRow = (check) => jsxs('div', {
        'data-dsh-fairy-check': check.id,
        'data-level': check.level,
        style: {
          border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
          borderRadius: '8px', padding: '9px 11px', display: 'grid', gap: '4px',
          background: check.level === 'fail'
            ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d84a3a) 8%, transparent)'
            : 'transparent'
        },
        children: [
          jsx('div', { style: { fontSize: '13px', fontWeight: 600 }, children: `${check.level === 'ok' ? '✅' : check.level === 'warn' ? '⚠️' : '❌'} ${check.title}` }),
          jsx('div', { style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.85 }, children: check.detail }),
          check.fix ? jsx('div', {
            style: {
              fontSize: '12px', lineHeight: 1.7,
              color: check.level === 'fail' ? 'var(--dsw-alias-state-error-primary, #d84a3a)' : 'var(--dsw-alias-label-secondary, inherit)'
            },
            children: `怎么修：${check.fix}`
          }) : null
        ]
      });
      /* [local patch 0.3.1] 结构摘要文本（只输出「字段名 + 类型」）。
       * [local patch 0.3.5] 面板上那个只读文本框已经删了 —— 这段数据现在只在「复制诊断信息」里用，
       * 所以从「每次渲染算一次的常量」改成「按需调用的函数」：复制时现算，永远是最新的。 */
      const readShapeText = () => {
        try {
          const current = (typeof window !== 'undefined' && window.__FAIRY_VOICE_DIAG__) || null;
          if (!current) return '（页面里没有 __FAIRY_VOICE_DIAG__：客户端脚本没跑到）';
          const lines = [];
          if (current.structure) lines.push('结构：' + String(current.structure));
          if (current.chatShape && current.chatShape !== '（未调用）') lines.push('useChat 结构：' + String(current.chatShape));
          if (Array.isArray(current.vcPropTypes) && current.vcPropTypes.length) lines.push('会话槽位 props：' + current.vcPropTypes.join(', '));
          if (Array.isArray(current.propTypes) && current.propTypes.length) lines.push('回复槽位 props：' + current.propTypes.join(', '));
          if (current.ctxSessionsKind) lines.push('ctx.sessions 类型：' + current.ctxSessionsKind);
          if (Array.isArray(current.ctxKeys) && current.ctxKeys.length) lines.push('插件 ctx：' + current.ctxKeys.join(', '));
          if (Array.isArray(current.ctxSessionsKeys) && current.ctxSessionsKeys.length) lines.push('ctx.sessions：' + current.ctxSessionsKeys.join(', '));
          if (!lines.length) {
            return '（还没有数据）探针：' + JSON.stringify({
              vcMounted: current.vcMounted === true,
              useSessionKind: current.useSessionKind || '（未上报）',
              maMounted: current.maMounted === true,
              maStoreMessages: typeof current.maStoreMessages === 'number' ? current.maStoreMessages : -1
            });
          }
          return lines.join('\n');
        } catch (error) { return '（读取失败）'; }
      };
      return jsxs('div', {
        className: 'dsh-fairy-voice-panel',
        'data-dsh-fairy-voice-panel': 'true',
        style: { marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', display: 'flex', flexDirection: 'column', gap: '12px' },
        children: [
          // [local patch 0.2.3] 人设预设放在最前面：它是"看得见效果"的第一步，且新手最容易卡在这
          jsx('h3', { style: { margin: 0, fontSize: '14px' }, children: 'Fairy 人设预设' }),
          /* [local patch 0.3.2] 待办子条目：人设没装好就【在这一区里】红字提醒。
           * 原来这条躺在面板顶部的大红框里，和这里的状态重复；现在它只出现在它该出现的地方。 */
          personaTodo ? jsx('div', {
            'data-dsh-fairy-persona-todo': 'true',
            style: {
              border: '1px solid var(--dsw-alias-state-error-primary, #d84a3a)',
              background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d84a3a) 12%, transparent)',
              borderRadius: '6px', padding: '8px 10px', fontSize: '12px', lineHeight: 1.7
            },
            children: '人设还没做完：勾上下面「第 1 步」的开关把预设装上，再点「一键设为默认预设」。做完之后，每开一个新会话都会自动带上 Fairy 人设。'
          }) : null,
          jsxs('label', { className: 'dsh-fairy-persona-row', 'data-dsh-fairy-persona': 'true', style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', lineHeight: 1.7 }, children: [
            jsx('input', { type: 'checkbox', checked: persona.installed, disabled: persona.busy || !persona.available, onChange: togglePersona }),
            jsx('span', {
              children: persona.installed
                ? '第 1 步 ✅ 预设已经装好了'
                : (persona.available ? '第 1 步：勾上这里，把 Fairy 人设装进 DSH' : '暂不可用 · 原因见下方红字')
            })
          ] }),
          jsxs('label', {
            className: 'dsh-fairy-persona-row',
            'data-dsh-fairy-default-state': persona.isDefault ? 'on' : 'off',
            style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', lineHeight: 1.7, opacity: 0.9 },
            children: [
              /* [local patch 0.3.5] 第 2 步也配一个复选框：位置、尺寸跟第 1 步完全一致，
               * 勾上 = 一键设为默认、取消 = 还原成原来的预设，跟下面那个按钮是同一个动作（toggleDefaultPreset）。
               * 原来这行是裸文字、顶到最左边，比上一行少一个复选框，看着不平整。 */
              jsx('input', {
                type: 'checkbox', checked: persona.isDefault === true,
                disabled: persona.busy || (!persona.installed && !persona.available),
                onChange: toggleDefaultPreset
              }),
              jsx('span', { children: persona.isDefault
                ? `第 2 步 ✅ 现在「新会话」默认就用 Fairy 人设了`
                : `第 2 步：把它设成「新会话默认用的预设」（现在的默认：${persona.defaultReadable ? (persona.defaultPreset || '未设置') : '查不到，可能插件宿主需要重启'}）` })
            ]
          }),
          jsxs('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, children: [
            jsx('button', {
              type: 'button',
              disabled: persona.busy || (!persona.installed && !persona.available),
              'data-dsh-fairy-default-preset': 'true',
              onClick: toggleDefaultPreset,
              children: persona.busy
                ? '处理中…'
                : persona.isDefault ? '取消默认（还原成原来的预设）' : '一键设为默认预设'
            }),
            jsx('button', { type: 'button', onClick: loadPersona, disabled: persona.busy, children: '刷新状态' })
          ] }),
          jsx('div', {
            style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.7 },
            children: '点上面这个按钮就够了：勾上第 1 步、再点「一键设为默认预设」，之后每开一个新会话都自动用 Fairy，不必每次都去选。'
          }),
          jsx('div', {
            style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.7 },
            children: '想自己选也行：① 勾上开关把预设装好 → ② 新开一个会话，空白页上有一个「Agent 预设」选择器（也可以去 设置 → Agent 预设）→ ③ 选中 Fairy。'
          }),
          jsx('div', {
            style: { fontSize: '12px', lineHeight: 1.7, fontWeight: 600, color: 'var(--dsw-alias-state-warning-primary, #c98a00)' },
            children: '⚠ 人设只对「新建的会话」生效：已经开着的会话不会变，请新开一个会话看效果。'
          }),
          persona.error ? jsx('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d84a3a)' }, children: persona.error }) : null,
          jsx('h3', { style: { margin: 0, paddingTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', fontSize: '14px' }, children: '朗读设置' }),
          jsx('div', { style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.7 }, children: '选引擎、填地址、指定参考音频。改完点「保存设置」即时生效，不用重启。' }),
          /* [local patch 0.3.2] 两种引擎的优缺点对照，替代原来那句「当前用……」。
           * 原来那句只讲当前这个引擎，使用者没法判断"要不要换"；这里两个都摆出来，
           * 让他按自己的机器（有没有显卡、能不能接受等几秒）自己选。
           * 布局用 auto-fit：面板宽就并排，窄就自动上下叠，窄面板下也不会挤成一团。 */
          jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: '8px', fontSize: '12px', lineHeight: 1.6 }, children: PROVIDER_OPTIONS.map((option) => jsxs('div', {
            key: option.id,
            onClick: () => selectEngine(option.id),
            style: { border: `1px solid ${configForm.engine === option.id ? 'var(--dsw-alias-state-success-primary, #2f9e44)' : 'var(--dsw-alias-border-l1, rgba(128,128,128,0.35))'}`, borderRadius: '6px', padding: '8px 10px', cursor: 'pointer' },
            children: [
              jsxs('div', { style: { fontWeight: 700, marginBottom: '4px' }, children: [
                jsx('span', { children: option.label }),
                configForm.engine === option.id ? jsx('span', { style: { fontWeight: 400, opacity: 0.7 }, children: '　· 当前' }) : null
              ] }),
              jsx('div', { style: { opacity: 0.75 }, children: option.summary })
            ]
          })) }),
          jsx('label', { style: { display: 'grid', gap: '4px', fontSize: '12px' }, children: [
            jsx('span', { children: '朗读服务' }),
            jsx('select', {
              value: configForm.engine,
              'data-dsh-fairy-engine': 'true',
              style: inputStyle,
              onChange: (event) => selectEngine(event.target.value),
              children: PROVIDER_OPTIONS.map((option) => jsx('option', { key: option.id, value: option.id, children: option.label }))
            })
          ] }),
          configForm.loaded === true && configForm.configured !== true ? jsx('div', {
            style: { fontSize: '12px', lineHeight: 1.7, padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))', borderRadius: '6px' },
            children: '刚装好就是这个状态 —— 你还没有配过朗读服务。Fairy 会照常打字回答，只是不出声。想让它说话：在上面四条路里挑一条。有显卡、愿意装的，本地两条路最像真人；不想装就用云端，填个 Key 就行。'
          }) : null,
          /* [local patch 0.3.4] 这行提示平时是灰的说明文字；只要表单改过、还没保存，
           * 就变成红色粗体警示 —— 因为「改了没保存」是这一步最常见的坑。 */
          jsx('div', {
            style: isConfigDirty
              ? { fontSize: '12px', lineHeight: 1.7, fontWeight: 700, color: 'var(--dsw-alias-state-error-primary, #d84a3a)' }
              : { fontSize: '12px', lineHeight: 1.7, opacity: 0.7 },
            children: isConfigDirty
              ? '⚠ 上面的改动还没保存 —— 点下面的「保存设置」才生效。想先试试新引擎通不通：直接点「重新自检」，它会用你眼前填的设置去测，不用先保存。'
              : '改完点「保存设置」才生效。想先试试新引擎通不通：直接点下面「重新自检」—— 它会用你眼前填的设置测，不用先保存。'
          }),
          /* [local patch 0.3.4] 只在选中 MOSS 时出现的一句提醒。
           * 起因：实测发现念出来的高频特质几乎 1:1 继承自参考音频（换参考 = 换音色），
           * 而多数人会随手抓一段带降噪痕迹的音频，结果就是发闷、发毛。
           * 用面板里既有的土黄警示色（与人设那行 ⚠ 同色），不加边框 ——
           * 免得和下面的安装引导框叠成两层框。 */
          isMossEngine ? jsx('div', {
            style: { fontSize: '12px', lineHeight: 1.7, fontWeight: 600, color: 'var(--dsw-alias-state-warning-primary, #c98a00)' },
            children: '⚠ 念出来的音色几乎完全由「参考音频」决定 —— 请按 reference\\README.txt 的要求放一段干净人声（48 kHz、峰值 -1 ~ -3 dB、别用降噪处理过的），否则会发闷、发毛。'
          }) : null,
          jsx('label', { style: { display: 'grid', gap: '4px', fontSize: '12px' }, children: [
            jsx('span', { children: isMossEngine ? 'MOSS 地址' : 'SoVITS 地址' }),
            jsx('input', {
              type: 'text', value: configForm.ttsUrl,
              placeholder: (isMossEngine ? configForm.defaultMossBase : (configForm.defaultSovitsBase || configForm.defaultBase)) || 'http://127.0.0.1:9880',
              'data-dsh-fairy-tts-url': 'true', style: inputStyle,
              onChange: (event) => setConfigForm((prev) => ({ ...prev, ttsUrl: event.target.value }))
            })
          ] }),
          // [local patch 0.3.2] 选了 MOSS 才出现的安装引导：不给文本框，给一个复制按钮。
          isMossEngine ? jsxs('div', {
            style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))', borderRadius: '6px' },
            children: [
              jsx('div', {
                style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.85 },
                children: 'MOSS 需要先在这台电脑上装一套（本仓库带一键安装脚本，坑都写死了）。不想自己动手的话：点下面的按钮复制一段话，发给你的 AI Agent，它会照着一份写好的说明去装。'
              }),
              jsxs('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, children: [
                jsx('button', {
                  type: 'button',
                  'data-dsh-fairy-copy-install': 'true',
                  onClick: copyInstallGuide,
                  children: '复制安装说明（发给你的 AI Agent）'
                })
              ] })
            ]
          }) : null,
          /* [local patch 0.3.6 · T-128] 云端服务自己的字段（Key / 模型 / 音色 / 自定义模板）。
           * 本地两条路不需要这些，所以只在选中云端时出现；值存在 configForm.providers[key] 里，
           * 四个服务各记一份，切来切去不丢。 */
          !isLocalProvider ? jsxs('div', { style: { display: 'grid', gap: '8px' }, children: cloudFields.map((field) => jsx('label', {
            key: field.key,
            style: { display: 'grid', gap: '4px', fontSize: '12px' },
            children: [
              jsx('span', { children: field.label }),
              jsx('input', {
                type: field.secret === true ? 'password' : 'text',
                value: String((configForm.providers[currentKey] || {})[field.key] ?? ''),
                placeholder: field.placeholder,
                'data-dsh-fairy-provider-field': field.key,
                style: inputStyle,
                onChange: (event) => setConfigForm((prev) => ({ ...prev, providers: { ...prev.providers, [currentKey]: { ...(prev.providers[currentKey] || {}), [field.key]: event.target.value } } }))
              })
            ]
          })) }) : null,
          isLocalProvider ? jsxs('div', { style: { display: 'grid', gap: '8px' }, children: [
            jsx('label', { style: { display: 'grid', gap: '4px', fontSize: '12px' }, children: [
              jsx('span', { children: '参考音频路径（.wav，3–10 秒干净人声）' }),
              jsx('input', {
                type: 'text', value: configForm.referenceAudioPath, placeholder: configForm.defaultReferenceAudioPath,
                'data-dsh-fairy-ref-audio': 'true', style: inputStyle,
                onChange: (event) => setConfigForm((prev) => ({ ...prev, referenceAudioPath: event.target.value }))
              })
            ] }),
            jsx('div', {
              style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.7 },
              children: '注意：这个文件放在你的【用户目录】下，不在插件目录里 —— 插件升级、重装、换安装位置都不会把它弄丢。目录不存在的话，插件启动时会自动建好，里面还附一份 README.txt。'
            })
          ] }) : null,
          jsxs('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, children: [
            jsx('button', {
              type: 'button', disabled: configForm.saving,
              'data-dsh-fairy-save-config': 'true',
              onClick: () => saveConfig(savePayload()),
              children: configForm.saving ? '保存中…' : '保存设置'
            }),
            isLocalProvider ? jsx('button', {
              type: 'button', disabled: configForm.saving,
              onClick: () => saveConfig({
                engine: configForm.engine,
                base: isMossEngine
                  ? (configForm.defaultMossBase || '')
                  : (configForm.defaultSovitsBase || configForm.defaultBase || ''),
                referenceAudioPath: configForm.defaultReferenceAudioPath || ''
              }),
              children: '恢复默认'
            }) : null
          ] }),
          configForm.message ? jsx('div', {
            style: { fontSize: '12px', color: configForm.error ? 'var(--dsw-alias-state-error-primary, #d84a3a)' : 'var(--dsw-alias-state-success-primary, #2f9e44)' },
            children: configForm.message
          }) : null,
          /* [local patch 0.3.2] 朗读自检挪到「朗读设置」下面 —— 先配置、后验证，跟人做事的顺序一致。
           * 明细默认折叠，但结论那一行（✅/❌）始终显示：不展开也知道好没好。
           * 版式是竖着三行：标题 / 开关 / 灰字说明。开关用一个 flex 包住，
           * 否则在外层 flex-column 里会被拉满整行宽，很难看。
           * copyState 放在折叠之外，因为「复制安装说明」按钮在设置区，折叠时也要能看到复制回执。 */
          jsx('h3', { style: { margin: 0, paddingTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', fontSize: '14px' }, children: '朗读自检' }),
          jsx('div', { style: { display: 'flex', margin: '4px 0 0' }, children: jsx('button', {
            type: 'button',
            'data-dsh-fairy-selfcheck-toggle': 'true',
            onClick: () => setSelfcheckOpen((prev) => !prev),
            children: selfcheckOpen ? '收起明细' : '展开明细'
          }) }),
          jsx('div', { style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.7, margin: '4px 0 0' }, children: '朗读不出声、或者朗读按钮是灰的？看这里。' }),
          (() => {
            const unconfigured = configForm.loaded === true && configForm.configured !== true;
            const tone = ready ? 'ok' : (unconfigured ? 'warn' : 'fail');
            const toneColor = tone === 'ok' ? 'var(--dsw-alias-state-success-primary, #2f9e44)'
              : tone === 'warn' ? 'var(--dsw-alias-state-warning-primary, #c98a00)'
              : 'var(--dsw-alias-state-error-primary, #d84a3a)';
            return jsx('div', {
              'data-dsh-fairy-voice-status': tone === 'ok' ? 'ready' : (unconfigured ? 'unconfigured' : 'blocked'),
              style: {
                border: `1px solid ${toneColor}`,
                background: `color-mix(in srgb, ${toneColor} ${tone === 'warn' ? 12 : 16}%, transparent)`,
                color: toneColor,
                borderRadius: '6px', padding: '8px 10px', fontSize: '12px', lineHeight: 1.6, fontWeight: 700
              },
              children: selfcheck.running
                ? `⏳ ${selfcheck.headline}`
                : tone === 'ok'
                  ? `✅ 朗读功能已就绪。${selfcheck.headline}`
                  : unconfigured
                    ? `⏸ 还没配置朗读服务 —— 不影响聊天，Fairy 只是不出声。${selfcheck.headline}`
                    : `❌ 朗读还不能用：${selfcheck.headline}${selfcheckOpen ? '' : ' —— 点「展开明细」看逐项原因和怎么修'}`
            });
          })(),
          copyState ? jsx('div', { style: { fontSize: '12px', opacity: 0.8 }, children: copyState }) : null,
          selfcheckOpen ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: [
            jsxs('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, children: [
              jsx('button', {
                type: 'button', disabled: selfcheck.running,
                'data-dsh-fairy-selfcheck': 'true',
                onClick: runSelfCheck,
                children: selfcheck.running ? '正在自检…' : '开始自检（含试合成）'
              }),
              jsx('button', { type: 'button', onClick: copyDiagnostics, children: '复制诊断信息' }),
              jsx('button', { type: 'button', onClick: runSelfCheck, children: '重新自检' })
            ] }),
            jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: allChecks.map(checkRow) }),
            jsx('div', {
              style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.7 },
              children: '提示：自动朗读开关和每条回复下方的朗读按钮，只会在真正的会话页面里出现；首页和刚新建的空白会话页不会显示，这是 DSH 本身的设计，不是插件坏了。'
            })
          ] }) : null,
          jsx('h3', { style: { margin: 0, paddingTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', fontSize: '14px' }, children: '语音简报（可选）' }),
          jsx('div', { style: rowStyle, children: brain.text }),
          jsx('input', {
            type: 'password', autoComplete: 'new-password', value: apiKey,
            placeholder: brain.configured ? '输入新 API Key 以替换当前密钥' : '输入 DeepSeek API Key',
            onChange: (event) => setApiKey(event.target.value)
          }),
          jsxs('div', { style: { display: 'flex', gap: '8px' }, children: [
            jsx('button', { type: 'button', disabled: busy || !apiKey.trim(), onClick: () => postConfig({ apiKey: apiKey.trim() }), children: '保存' }),
            brain.configured ? jsx('button', { type: 'button', disabled: busy, onClick: () => postConfig({ clear: true }), children: '移除密钥' }) : null
          ] }),
          // [local patch 0.3.1] 面板最底部：诊断信息（结构摘要只有字段名与类型，不含任何对话内容）
          jsx('h3', { style: { margin: 0, paddingTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', fontSize: '14px' }, children: '诊断信息（排查用）' }),
          jsx('div', {
            style: { fontSize: '12px', lineHeight: 1.7, opacity: 0.7, maxWidth: '380px' },
            children: '语音出问题时：点下面这个按钮复制诊断信息 —— 结构摘要已经一起带上了，复制一次、粘一次就行。里面没有聊天内容；诊断信息带本机路径和自检结果，不想公开可以自行删掉。'
          }),
          // [local patch 0.3.2] 自检明细折叠后，原来那个「复制诊断信息」按钮可能被藏起来，
          // 所以这里再放一个 —— 这一节的用途本来就是「把信息发出去」，按钮放这儿更顺手。
          jsx('button', { type: 'button', 'data-dsh-fairy-copy-diagnostics': 'true', onClick: copyDiagnostics, children: '复制诊断信息' }),
          copyState ? jsx('div', { style: { fontSize: '12px', opacity: 0.8 }, children: copyState }) : null,
          // [local patch 0.3.5] 原来这里还有一个「结构摘要」只读文本框，已删除 —— 它的内容会跟着「复制诊断信息」一起走
          diagText ? jsx('div', { style: { fontSize: '11px', opacity: 0.6 }, children: '诊断信息（点了「复制诊断信息」后出现在这里）' }) : null,
          diagText ? jsx('textarea', {
            readOnly: true, value: diagText, rows: 6,
            style: { ...inputStyle, width: '100%', maxWidth: '380px', height: 'auto', padding: '8px 10px', whiteSpace: 'pre', fontSize: '11px', opacity: 0.85 }
          }) : null
        ]
      });
    }

'@
  # 顶部声明行：版本号取自仓库根的 VERSION 文件，打包时间取包内最新文件时间（每次生成现算）
  $versionText = 'unknown'
  $versionFile = Join-Path $Root 'VERSION'
  if (Test-Path -LiteralPath $versionFile) {
    $versionText = ([System.IO.File]::ReadAllText($versionFile, $script:MergeUtf8)).Trim()
  } else {
    Write-Warning "找不到版本文件：$versionFile（设置页将显示 unknown）"
  }
  $newestFile = Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\release\\|\\snapshots\\' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $stampText = 'unknown'
  if ($newestFile) { $stampText = $newestFile.LastWriteTime.ToString('yyyy-MM-dd HH:mm') }
  # [compat] 本地版本必须带上 -compat.N 后缀，否则更新检查会失效：
  # 远端 tag 形如 v0.3.8-compat.1，而 isNewer() 只逐段比数字 ——
  # 若本地填裸 '0.3.8'，两边的数字段都是 [0,3,8]，永远判定为「已是最新」。
  # 后缀串必须与发布用的 git tag 保持一致（见 docs\仓库与上游.md §5）。
  $localVersionSuffix = '-compat.1'
  $noticeText = '当前版本 v' + $versionText + ' · 内部整合分支（血缘与署名见仓库根 NOTICE / CONTRIBUTORS.md）'
  $panel = $panel.Replace('__FAIRY_NOTICE__', $noticeText)
  # [local patch 0.3.5] 检查更新要用它跟远端 tag 比大小，所以单独烤一份版本号
  $panel = $panel.Replace('__FAIRY_VERSION__', ($versionText + $localVersionSuffix))
  $anchor1 = "`t`tfunction Settings({ controller, identitySettings }) {"
  if (([regex]::Matches($text, [regex]::Escape($anchor1))).Count -ne 1) { throw "合并锚点1匹配数不为 1" }
  $text = $text.Replace($anchor1, $panel + $anchor1)

  $old2 = "`t`t`t`t}, () => jsx(Settings, {`n`t`t`t`t`tcontroller,`n`t`t`t`t`tidentitySettings`n`t`t`t`t})));"
  $new2 = "`t`t`t`t}, () => jsxs('div', {`n`t`t`t`t`tchildren: [jsx(FairyNotice, {}), jsx('h3', { style: { margin: 0, paddingTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', fontSize: '14px' }, children: '通用' }), jsx(Settings, {`n`t`t`t`t`t`tcontroller,`n`t`t`t`t`t`tidentitySettings`n`t`t`t`t`t}), jsx(FairyVoicePanel, {})]`n`t`t`t`t})));"
  if (-not $text.Contains($old2)) {
    $old2 = $old2.Replace("`n", "`r`n")
    $new2 = $new2.Replace("`n", "`r`n")
  }
  if (-not $text.Contains($old2)) { throw "合并锚点2未找到" }
  $text = $text.Replace($old2, $new2)
  # 设置入口改名：内容已全部并入，标签统一为 Fairy
  $text = $text.Replace('label: () => "HDD 视觉与 Fairy 身份"', 'label: () => "Fairy"')
  return $text
}

# 语音包：移除它自己的 settings.section 注册（已并入视觉包的设置栏）
function New-MergedVoiceText {
  param([Parameter(Mandatory)][string]$Root)
  $pristine = Join-Path $Root 'upstream-originals\fairy-voice-client.js'
  if (-not (Test-Path -LiteralPath $pristine)) { throw "找不到上游原件：$pristine" }
  $text = [System.IO.File]::ReadAllText($pristine, $script:MergeUtf8)
  $target = "        injectVoiceSlot(ctx, 'settings.section', { id: 'fairy-voice-brain', order: 30, label: () => '语音简报' }, VoiceBrainSection),"
  if (([regex]::Matches($text, [regex]::Escape($target))).Count -ne 1) { throw "语音包锚点匹配数不为 1" }
  $text = $text.Replace($target, "        // [local patch 0.2.0] 设置入口已并入 fairy-visual 的单个 Fairy 设置栏")

  # [local patch 0.2.3] 诊断通道：把"能不能读到消息"的实况暴露给设置栏自检面板。
  # 只写结构信息（字段名与数量），不含任何对话内容；自身失败也不影响朗读。
  $diagAnchor = "      return {`n        found,`n        currentTurnFinals,"
  if (([regex]::Matches($text, [regex]::Escape($diagAnchor))).Count -ne 1) { throw "诊断通道锚点匹配数不为 1（settings-merge 需要维护）" }
  $diagCode = @'
      // [local patch 0.2.3] 诊断通道：把"消息识别"的实况交给设置栏自检面板。
      // 只写结构信息（字段名与数量），不含任何对话内容；这里出错也不影响朗读。
      // [local patch 0.3.1] 结构摘要：__fairyShape 定义在模块作用域（见文件末尾的诊断标记处）
      try {
        globalThis.__FAIRY_VOICE_DIAG__ = {
          ...(globalThis.__FAIRY_VOICE_DIAG__ || {}),
          updatedAt: Date.now(),
          timelineRead: true,
          structure: (() => {
            try { return String(__fairyShape(snapshot, 2, 40)).slice(0, 2000); } catch (error) { return 'unreadable'; }
          })(),
          hasSnapshot: Boolean(snapshot),
          snapshotKeys: snapshot && typeof snapshot === 'object' ? Object.keys(snapshot).slice(0, 24) : [],
          hasChat: Boolean(chat),
          chatSource: __fairyChat ? 'useChat' : 'snapshot.chat',
          chatKeys: chat && typeof chat === 'object' ? Object.keys(chat).slice(0, 24) : [],
          orderLength: Array.isArray(chat?.order) ? chat.order.length : -1,
          nodesKind: chat?.nodes instanceof Map ? 'Map' : typeof chat?.nodes,
          turnCount: Array.isArray(chat?.timeline?.turnOrder) ? chat.timeline.turnOrder.length : -1,
          finalCount: found.length,
          currentTurnFinalCount: currentTurnFinals.length,
          userSeq,
          sessionKey: String(sessionKey),
          running: activeAssistantSteps.length > 0 || activeTools.length > 0,
          activeTools: activeTools.length,
          runningSource: __fairyRunningSource,
        };
      } catch (error) { /* 诊断不应影响朗读 */ }
      return {
        found,
        currentTurnFinals,
'@
  $text = $text.Replace($diagAnchor, $diagCode)

  # [local patch 0.3.1] 探针 A：控制器到底有没有渲染、DSH 还提不提供 useSession
  $vcAnchor = "    function VoiceController({ useSession, sessionId }) {"
  if (([regex]::Matches($text, [regex]::Escape($vcAnchor))).Count -ne 1) { throw "控制器探针锚点匹配数不为 1（settings-merge 需要维护）" }
  $vcCode = @'
    function VoiceController(__fairyProps) {
      const { useSession, sessionId, useChat } = __fairyProps;
      // [local patch 0.3.1] DSH 0.1.2-rc.1 起聊天内容不在 useSession 快照里，改由 useChat 提供
      const __fairyChatValue = typeof useChat === 'function' ? useChat((value) => value) : null;
      // [local patch 0.3.1] 探针（只写诊断；失败也不影响朗读）
      try {
        globalThis.__FAIRY_VOICE_DIAG__ = {
          ...(globalThis.__FAIRY_VOICE_DIAG__ || {}),
          vcMounted: true,
          vcAt: Date.now(),
          useSessionKind: typeof useSession,
          vcPropTypes: Object.keys(__fairyProps || {}).slice(0, 40).map((key) => key + ':' + typeof __fairyProps[key]),
          chatShape: __fairyShape(__fairyChatValue, 2, 40),
        };
      } catch (error) { /* 诊断不应影响朗读 */ }
'@
  $text = $text.Replace($vcAnchor, $vcCode)

  # [local patch 0.3.1] 探针 B：每条回复的朗读按钮槽位有没有渲染、有没有拿到消息
  $maAnchor = "      if (!message) return null;"
  if (([regex]::Matches($text, [regex]::Escape($maAnchor))).Count -ne 1) { throw "消息动作探针锚点匹配数不为 1（settings-merge 需要维护）" }
  $maCode = @'
      // [local patch 0.3.1] 探针：消息动作槽位有没有渲染、有没有拿到消息
      try {
        globalThis.__FAIRY_VOICE_DIAG__ = {
          ...(globalThis.__FAIRY_VOICE_DIAG__ || {}),
          maMounted: true,
          maAt: Date.now(),
          maHasMessage: Boolean(message),
          maStoreMessages: voiceTimelineStore.getSnapshot().messagesById.size,
        };
      } catch (error) { /* 诊断不应影响朗读 */ }
      if (!message) return null;
'@
  $text = $text.Replace($maAnchor, $maCode)

  # [local patch 0.3.1] 探针 C：插件上下文里有哪些服务（找消息真正的入口）
  $ctxAnchor = "      return diagnostics.guard('apply', () => {`n      ensureVoiceControlStyles();"
  if (([regex]::Matches($text, [regex]::Escape($ctxAnchor))).Count -ne 1) { throw "上下文探针锚点匹配数不为 1（settings-merge 需要维护）" }
  $ctxCode = @'
      return diagnostics.guard('apply', () => {
      // [local patch 0.3.1] 探针：插件上下文里有哪些服务
      try {
        globalThis.__FAIRY_VOICE_DIAG__ = {
          ...(globalThis.__FAIRY_VOICE_DIAG__ || {}),
          ctxKeys: Object.keys(ctx || {}).slice(0, 60),
          ctxSessionsKind: ctx ? typeof ctx.sessions : 'no-ctx',
          ctxSessionsKeys: ctx && ctx.sessions && typeof ctx.sessions === 'object' ? Object.keys(ctx.sessions).slice(0, 40) : [],
        };
      } catch (error) { /* 诊断不应影响朗读 */ }
      // [local patch 0.3.1] 语音异常时右下角提示（位置与「预设未启用」提示一致；只在真的读不到消息时出现）
      try {
        const __fairyAlertCheck = () => {
          try {
            const existing = document.getElementById('dsh-fairy-voice-alert');
            const current = globalThis.__FAIRY_VOICE_DIAG__ || {};
            const broken = current.timelineRead === true && current.hasChat !== true;
            if (!broken) { if (existing) existing.remove(); return; }
            if (existing) return;
            if (Date.now() < Number(localStorage.getItem('dsh.fairy.voiceAlertSnooze') || 0)) return;
            const box = document.createElement('div');
            box.id = 'dsh-fairy-voice-alert';
            box.setAttribute('data-dsh-fairy-voice-alert', 'true');
            box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:320px;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.7;background:#c0392b;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.3)';
            const msg = document.createElement('div');
            msg.textContent = '语音异常：读不到当前会话的消息，朗读会没有内容。请到 设置 → Fairy 最底部「诊断信息」复制内容，提交到本仓库 Issues。';
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;margin-top:8px;justify-content:flex-end';
            const later = document.createElement('button');
            later.type = 'button';
            later.textContent = '稍后再说';
            later.onclick = () => { try { localStorage.setItem('dsh.fairy.voiceAlertSnooze', String(Date.now() + 6 * 3600 * 1000)); } catch (error) { /* 存不了就照常显示 */ } box.remove(); };
            const never = document.createElement('button');
            never.type = 'button';
            never.textContent = '不再提示';
            never.onclick = () => { try { localStorage.setItem('dsh.fairy.voiceAlertSnooze', String(Date.now() + 30 * 24 * 3600 * 1000)); } catch (error) { /* 存不了就照常显示 */ } box.remove(); };
            row.append(later, never);
            box.append(msg, row);
            document.body.appendChild(box);
          } catch (error) { /* 提示失败不影响朗读 */ }
        };
        setTimeout(__fairyAlertCheck, 8000);
        setInterval(__fairyAlertCheck, 15000);
      } catch (error) { /* 提示失败不影响朗读 */ }
      ensureVoiceControlStyles();
'@
  $text = $text.Replace($ctxAnchor, $ctxCode)

  # [local patch 0.3.1] 适配层：DSH 换了数据源，把 useChat 读到的 chat 喂给读消息函数
  $useSessionAnchor = "      const snapshot = useSession(readVoiceTimeline);"
  if (([regex]::Matches($text, [regex]::Escape($useSessionAnchor))).Count -ne 1) { throw "useSession 接线锚点匹配数不为 1（settings-merge 需要维护）" }
  $useSessionCode = @'
      // [local patch 0.3.1] 用 useCallback 包一层：chat 变化时选择器重建，自动朗读不会漏消息
      const __fairyReadTimeline = React.useCallback((value) => readVoiceTimeline(value, __fairyChatValue), [__fairyChatValue]);
      const snapshot = useSession(__fairyReadTimeline);
'@
  $text = $text.Replace($useSessionAnchor, $useSessionCode)

  # [local patch 0.3.1] readVoiceTimeline 新增 chat 入参；取不到时回落到旧的 snapshot.chat（兼容旧版 DSH）
  $timelineAnchors = @(
    @{ Old = "    function readVoiceTimeline(snapshot) {"; New = "    function readVoiceTimeline(snapshot, __fairyChat) {" },
    @{ Old = "      const chat = snapshot?.chat;"; New = "      // [local patch 0.3.1] chat 由 useChat 提供，取不到时回落到旧结构`n      const chat = __fairyChat || snapshot?.chat;" },
    @{ Old = "      const userSeq = (snapshot?.chat?.legacy?.nodes || [])"; New = "      const userSeq = (chat?.legacy?.nodes || [])" },
    @{ Old = "      for (const call of snapshot?.chat?.legacy?.runningCalls || []) {"; New = "      for (const call of chat?.legacy?.runningCalls || []) {" }
  )
  foreach ($item in $timelineAnchors) {
    if (([regex]::Matches($text, [regex]::Escape($item.Old))).Count -ne 1) { throw "读消息适配锚点匹配数不为 1：$($item.Old)" }
    $text = $text.Replace($item.Old, $item.New)
  }

  # [local patch 0.3.1] runningCalls 兼容：新 chat 不再有 legacy.runningCalls，改用节点索引兜底
  $runningAnchor = "      for (const call of chat?.legacy?.runningCalls || []) {`n        collectRunningTools(call, activeTools, activeToolIds);`n      }"
  if (([regex]::Matches($text, [regex]::Escape($runningAnchor))).Count -ne 1) { throw "运行中工具兜底锚点匹配数不为 1（settings-merge 需要维护）" }
  $runningCode = @'
      // [local patch 0.3.1] DSH 0.1.2-rc.1 的 chat 不再提供 legacy.runningCalls：
      // 先走旧来源，取不到再从节点索引里挑仍在 running 的工具节点兜底；两条都空就跳过（不影响朗读）。
      let __fairyRunningSource = 'none';
      for (const call of chat?.legacy?.runningCalls || []) {
        __fairyRunningSource = 'legacy';
        collectRunningTools(call, activeTools, activeToolIds);
      }
      if (__fairyRunningSource === 'none') {
        try {
          const __fairyIndex = chat?.nodes?.byKey;
          const __fairyNodes = __fairyIndex instanceof Map ? [...__fairyIndex.values()] : Object.values(__fairyIndex || {});
          for (const node of __fairyNodes) {
            const data = node?.data && typeof node.data === 'object' ? node.data : node;
            const status = data?.status ?? node?.status;
            if (status !== 'running' || !String(node?.kind || '').includes('tool')) continue;
            const callId = data?.callId ?? data?.id ?? node?.callId;
            if (!callId) continue;
            collectRunningTools({ callId, name: data?.name ?? data?.toolName ?? '', turn: data?.turn, step: data?.step }, activeTools, activeToolIds);
          }
          if (activeTools.length) __fairyRunningSource = 'nodes';
        } catch (error) { /* 兜底失败不影响朗读 */ }
      }
'@
  $text = $text.Replace($runningAnchor, $runningCode)

  # 标记客户端已加载，供自检面板区分"控件没挂上"和"挂上了但没数据"
  $mountedAnchor = "    return { apply, inject: ['slots', 'sessions'] };"
  if (([regex]::Matches($text, [regex]::Escape($mountedAnchor))).Count -ne 1) { throw "挂载标记锚点匹配数不为 1（settings-merge 需要维护）" }
  $mountedCode = @'
    // [local patch 0.3.1] 结构摘要工具（模块作用域）：只输出「字段名 + 类型」，最多两层，不含任何取值
    const __fairyShape = (value, depth, maxKeys) => {
      try {
        if (value === null) return 'null';
        if (typeof value !== 'object') return typeof value;
        if (Array.isArray(value)) return 'Array(' + value.length + ')';
        if (value instanceof Map) return 'Map(' + value.size + ')';
        if (value instanceof Set) return 'Set(' + value.size + ')';
        const keys = Object.keys(value);
        if (depth <= 0) return 'object(' + keys.length + ')';
        return '{' + keys.slice(0, maxKeys).map((key) => key + ':' + __fairyShape(value[key], depth - 1, 4)).join(', ') + '}';
      } catch (error) { return 'unreadable'; }
    };
    // [local patch 0.2.3] 客户端已加载标记（自检面板据此判断朗读控件是否挂上）
    try {
      globalThis.__FAIRY_VOICE_DIAG__ = { ...(globalThis.__FAIRY_VOICE_DIAG__ || {}), mounted: true, mountedAt: Date.now() };
    } catch (error) { /* 诊断不应影响朗读 */ }
    return { apply, inject: ['slots', 'sessions'] };
'@
  $text = $text.Replace($mountedAnchor, $mountedCode)
  return $text
}

# 应用/恢复，返回 Changed / State / PreviousState / Snapshot
function Set-SettingsMerge {
  param(
    [Parameter(Mandatory)][string]$Root,
    [ValidateSet('merged', 'upstream')][string]$Mode = 'merged',
    [switch]$Snapshot,
    [switch]$Force
  )
  $voice  = Join-Path $Root 'fairy-voice\dsh-fairy-voice\lib\client.js'
  $visual = Join-Path $Root 'fairy-visual\dsh-fairy-visual\lib\client.js'
  foreach ($p in @($voice, $visual)) { if (-not (Test-Path -LiteralPath $p)) { throw "找不到目标文件：$p" } }

  $current = Get-SettingsMergeState -Root $Root
  if (-not $Force -and $current -eq $Mode) {
    return [pscustomobject]@{ Changed = $false; State = $Mode; PreviousState = $current; Snapshot = $null }
  }

  $snapDir = $null
  if ($Snapshot) {
    $snapDir = Join-Path $Root 'snapshots'
    New-Item -ItemType Directory -Force -Path $snapDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item -LiteralPath $voice  -Destination (Join-Path $snapDir "voice-client.js.$stamp.$current.bak")  -Force
    Copy-Item -LiteralPath $visual -Destination (Join-Path $snapDir "visual-client.js.$stamp.$current.bak") -Force
  }

  if ($Mode -eq 'upstream') {
    Copy-Item -LiteralPath (Join-Path $Root 'upstream-originals\fairy-voice-client.js')  -Destination $voice  -Force
    Copy-Item -LiteralPath (Join-Path $Root 'upstream-originals\fairy-visual-client.js') -Destination $visual -Force
  } else {
    [System.IO.File]::WriteAllText($visual, (New-MergedVisualText -Root $Root), $script:MergeUtf8)
    [System.IO.File]::WriteAllText($voice,  (New-MergedVoiceText  -Root $Root), $script:MergeUtf8)
  }

  $after = Get-SettingsMergeState -Root $Root
  if ($after -ne $Mode) { throw "合并校验失败：期望 $Mode，实际 $after" }
  return [pscustomobject]@{ Changed = $true; State = $after; PreviousState = $current; Snapshot = $snapDir }
}
