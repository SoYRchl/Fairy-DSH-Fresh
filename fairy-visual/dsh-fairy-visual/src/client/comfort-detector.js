/* Local-only, explainable classification; user text never leaves the page. */
const COMFORT_CUES = [
  /求安慰|安慰我|哄哄我|温柔一点|对我温柔|许愿精灵/, /难受|难过|伤心|委屈|孤独|寂寞|害怕|恐慌|焦虑|崩溃|绝望|失望|痛苦|心累|好累|疲惫|精疲力竭|压力好大|撑不住|受不了了|想哭|哭了|睡不着|不想活|想关闭自己|想把自己关机|想消失|被否定|否定我|被拒绝|被抛下/, /我不好|我很糟|我好糟|我被.*伤害|没人理解我|没有人理解我/, /\b(?:sad|upset|lonely|scared|afraid|anxious|panic(?:ked)?|depressed|overwhelmed|stressed|hurt|crying|cry|comfort me|be gentle)\b/i,
];

/* An explicit request not to comfort is stronger than a quoted distress word
 * (for example: “不要安慰我，直接给方案”). */
const COMFORT_SUPPRESS_CUES = [
  /(?:不用|不要|别|无需|不必).{0,8}(?:安慰|哄|温柔对待)/,
  /(?:只要|请).{0,8}(?:分析|方案|结论|下一步).{0,8}(?:不用|不要|别).{0,8}(?:安慰|哄)/,
  /\b(?:don't|do not|no need to)\s+(?:comfort|coddle|reassure)\b/i,
];

const COMFORT_EXIT_CUES = [
  /我好多了|好多了|没事了|没关系了|已经好了|不用安慰了|不需要安慰了|可以了|结束这个话题|换个话题|说点别的|回到正题|继续工作|切换会话|切换页面|打开新会话|新建会话/,
  /\b(?:i(?:'m| am) better|feel better|all good|no worries|never mind|change the subject|let's move on|back to work)\b/i,
  /帮我(?:写|改|查|解释|翻译|总结|实现)|我们聊聊代码|开始工作|下一个问题|换个问题|打开设置|怎么实现/, 
  /\b(?:help me write|debug|explain|translate|summarize|next question|change topics?|let's work on|how do I implement)\b/i,
];

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function hasCue(text, cues) {
  return cues.some((cue) => cue.test(text));
}

export function classifyComfortMessage(text) {
  const normalized = normalize(text);
  if (!normalized) return 'hold';
  if (hasCue(normalized, COMFORT_SUPPRESS_CUES)) return 'exit';
  if (hasCue(normalized, COMFORT_CUES)) return 'trigger';
  if (hasCue(normalized, COMFORT_EXIT_CUES)) return 'exit';
  return 'hold';
}

function valueText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(' ');
  if (!value || typeof value !== 'object') return '';
  return [value.text, value.content, value.value, value.message]
    .map(valueText).filter(Boolean).join(' ');
}

function nodeText(node) {
  const blocks = Array.isArray(node?.data?.blocks) ? node.data.blocks : [];
  return blocks.map(valueText).concat(
    valueText(node?.data?.text),
    valueText(node?.data?.content),
    valueText(node?.data?.message),
    valueText(node?.data?.input),
  ).join(' ');
}

function chatNode(nodes, key) {
  return nodes?.get?.(key) || nodes?.[key] || null;
}

function isUserNode(node) {
  return node?.kind === 'user' || node?.data?.role === 'user';
}

/*
 * Walk backward to the latest decisive user cue. Neutral continuation does
 * not clear an earlier comfort request, while an explicit recovery/topic-exit
 * cue does. Ambiguous closers such as “先这样” deliberately keep the state.
 * Reading the committed Session snapshot also covers a fresh session's first
 * message, which has no stable session id at composer-submit time.
 */
export function deriveSessionComfort(snapshot) {
  const order = Array.from(snapshot?.chat?.order || []);
  const nodes = snapshot?.chat?.nodes;
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const node = chatNode(nodes, order[index]);
    if (!isUserNode(node)) continue;
    const result = classifyComfortMessage(nodeText(node));
    if (result === 'trigger') return true;
    if (result === 'exit') return false;
  }
  return false;
}
