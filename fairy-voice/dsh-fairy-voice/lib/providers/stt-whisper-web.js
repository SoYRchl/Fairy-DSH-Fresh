/*
 * Fairy-DSH [T-130] 浏览器端 Whisper 标记 provider：transformers.js 在浏览器跑模型，
 * 所以宿主只存客户端的配置，并在 `/fairy-voice/stt` 上答 409，与浏览器识别一致。
 *
 * ★ 形状来源：云朵版 `stt-whisper-web.js`（D-042/D-056：只取形状，重新实现）。
 */
import { clientSideSttProvider } from './stt-http.js';

export const WHISPER_WEB_STT_ID = 'whisper-web';

export const STT_WHISPER_WEB_DEFAULTS = Object.freeze({
  moduleUrl: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm',
  modelId: 'onnx-community/whisper-base',
  device: 'wasm',
  dtype: 'q8',
  language: 'chinese',
  // 可选的 Hugging Face 镜像，语义同 TTS 引擎字段。
  resourceBase: '',
});

export const whisperWebSttProvider = clientSideSttProvider(WHISPER_WEB_STT_ID, '浏览器端语音输入');
