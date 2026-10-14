// [T-109] 并入自 Fairy 完整安装包（不明来源）的 composer-takeover-v2 修复组，
//   已按 02 §3「借壳不借包」人工审计后原样采纳：全文 25 行，逻辑自洽、无外部依赖、
//   不使用 eval/网络/宿主私有 API。原件 sha256 =
//   313851D037E7907F1AD83B8073B70A07CD7C268F6B2F2C4F41D9AD07FD74F8EE
//   出处：Fairy-完整安装包/resources/homes/1-original/fairy-visual/dsh-fairy-visual/src/client/scroll-position-guard.js
//   审计记录：Fairy-DSH焕新/07 与 logs/操作日志.md（2026-10-14）
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const BOTTOM_EPSILON = 24;

function captureScrollPositions(nodes) {
  const snapshots = new Map();
  (nodes || []).forEach((node) => {
    if (!node || typeof node.scrollTop !== 'number') return;
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    const distanceFromBottom = Math.max(0, maxScrollTop - node.scrollTop);
    snapshots.set(node, { scrollTop: node.scrollTop, distanceFromBottom, atBottom: distanceFromBottom <= BOTTOM_EPSILON });
  });
  return snapshots;
}

function restoreScrollPositions(snapshots) {
  snapshots?.forEach(({ scrollTop, atBottom }, node) => {
    if (!node?.isConnected) return;
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    const nextScrollTop = atBottom ? maxScrollTop : clamp(scrollTop, 0, maxScrollTop);
    if (Math.abs(node.scrollTop - nextScrollTop) > 0.5) node.scrollTop = nextScrollTop;
  });
}

module.exports = { captureScrollPositions, restoreScrollPositions };
