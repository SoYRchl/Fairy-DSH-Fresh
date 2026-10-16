/*
 * Fairy-DSH [T-130] 浏览器端语音识别标记 provider。宿主没有麦克风，
 * 所以 `/fairy-voice/stt` 对它答 409，真正的活在浏览器那一半（Web Speech API）。
 *
 * ★ 形状来源：云朵版 `stt-browser.js`（D-042/D-056：只取形状，重新实现）。
 *   本仓没有 `available()`，改走注册表通用的 `status()`（标记类一律 available）。
 */
import { clientSideSttProvider } from './stt-http.js';

export const BROWSER_STT_ID = 'browser';

export const STT_BROWSER_DEFAULTS = Object.freeze({ lang: 'zh-CN' });

export const browserSttProvider = clientSideSttProvider(BROWSER_STT_ID, '浏览器端语音输入');
