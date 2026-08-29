const React = require('react');
const { createLifecycleScope } = require('./lifecycle.js');
const { createManagedMutationObserver } = require('./dom-observer-manager.js');
const { createPointerDrag } = require('./pointer-drag.js');
const { claimScrollbarLifecycle } = require('./scrollbar.js');
const { HDD_SCROLL_TARGET_SELECTOR, hddScrollTargets } = require('./dom-adapter.js');

function install(_lifecycle = null) {
    // Lifecycle: HDD overlay scrollbars
    // Owner: document and target scroll node
    // Contract: lifecycle-ownership.json#owners[subsystem=HDD overlay scrollbars]
    function HddOverlayScrollbars({ enabled }) {
      React.useLayoutEffect(() => {
        if (!enabled || !document.body) return undefined;
        const lifecycle = claimScrollbarLifecycle(document);
        const host = document.createElement('div');
        host.className = 'dsh-hdd-scrollbar-layer';
        host.setAttribute('data-plugin', 'dsh-fairy-visual');
        host.setAttribute('aria-label', 'HDD 滚动条');
        document.body.appendChild(host);
        let structureObserver = null;
        let resizeObserver = null;
        const bindings = new Map();
        const TRACK_WIDTH = 12;
        const EDGE_INSET = 1;

        const schedule = () => {
          if (!lifecycle.disposed) lifecycle.scheduleFrame('scrollbar-sync', sync, 'scrollbars:sync-frame');
        };
        const scheduleStructure = () => {
          if (!lifecycle.disposed) lifecycle.scheduleFrame('scrollbar-bind', bindTargets, 'scrollbars:bind-frame');
        };
        const updateAria = (thumb, target, maxScroll) => {
          thumb.setAttribute('aria-valuemin', '0');
          thumb.setAttribute('aria-valuemax', String(Math.round(maxScroll)));
          thumb.setAttribute('aria-valuenow', String(Math.round(target.scrollTop)));
        };
        const armIdle = (binding) => {
          binding.idleDeadline = Date.now() + 850;
          if (binding.idleTimer) return;
          const settle = () => {
            const remaining = binding.idleDeadline - Date.now();
            if (remaining > 0) {
              binding.idleTimer = binding.lifecycle.timeout(settle, remaining, `scrollbar:${binding.key}:idle-settle`);
              return;
            }
            binding.idleTimer = null;
            binding.track.setAttribute('data-idle', 'true');
            binding.track.setAttribute('data-active', 'false');
          };
          binding.idleTimer = binding.lifecycle.timeout(settle, 850, `scrollbar:${binding.key}:idle-settle`);
        };
        const show = (binding) => {
          binding.track.setAttribute('data-idle', 'false');
          binding.track.setAttribute('data-active', 'true');
          armIdle(binding);
        };
        const createBinding = (key, target) => {
          const track = document.createElement('div');
          track.className = 'dsh-history-overlay-scrollbar';
          track.setAttribute('data-target', key);
          track.setAttribute('role', 'scrollbar');
          track.setAttribute('aria-orientation', 'vertical');
          track.setAttribute('tabindex', '0');
          const thumb = document.createElement('div');
          thumb.className = 'dsh-history-overlay-scrollbar-thumb';
          track.appendChild(thumb);
          host.appendChild(track);
          const bindingLifecycle = createLifecycleScope(`scrollbar:${key}`);
          const binding = { key, target, track, thumb, pointerDrag: null, idleTimer: null, idleDeadline: 0, lifecycle: bindingLifecycle };
          track.setAttribute('data-idle', 'true');
          const onScroll = () => {
            show(binding);
            schedule();
          };
          const onPointerDown = (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const trackRect = track.getBoundingClientRect();
            const thumbRect = thumb.getBoundingClientRect();
            const travel = Math.max(1, trackRect.height - thumbRect.height);
            const payload = {
              pointerId: event.pointerId,
              startY: event.clientY,
              startScrollTop: target.scrollTop,
              travel,
              maxScroll: Math.max(0, target.scrollHeight - target.clientHeight),
            };
            show(binding);
            binding.pointerDrag.start(event, payload);
          };
          const onPointerMove = (_event, session) => {
            const drag = session.payload;
            const next = drag.startScrollTop + (_event.clientY - drag.startY) * drag.maxScroll / drag.travel;
            target.scrollTop = Math.max(0, Math.min(drag.maxScroll, next));
            schedule();
          };
          binding.pointerDrag = createPointerDrag({
            getTarget: () => thumb,
            getLockNodes: () => [track],
            onMove: onPointerMove,
            onEnd: schedule,
            onCancel: schedule,
          });
          const onTrackPointerDown = (event) => {
            if (event.target === thumb || event.button !== 0) return;
            const rect = track.getBoundingClientRect();
            const direction = event.clientY < rect.top + rect.height * .5 ? -1 : 1;
            target.scrollTop += direction * target.clientHeight * .85;
            show(binding);
            schedule();
          };
          const onKeyDown = (event) => {
            const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
            const step = event.shiftKey ? target.clientHeight : 48;
            let next = null;
            if (event.key === 'ArrowUp') next = target.scrollTop - step;
            else if (event.key === 'ArrowDown') next = target.scrollTop + step;
            else if (event.key === 'PageUp') next = target.scrollTop - target.clientHeight;
            else if (event.key === 'PageDown') next = target.scrollTop + target.clientHeight;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = maxScroll;
            if (next === null) return;
            event.preventDefault();
            target.scrollTop = Math.max(0, Math.min(maxScroll, next));
            show(binding);
            schedule();
          };
          bindingLifecycle.add(() => track.remove(), `scrollbar:${key}:track-node`);
          bindingLifecycle.on(target, 'scroll', onScroll, { passive: true, label: `scrollbar:${key}:target-scroll` });
          bindingLifecycle.on(thumb, 'pointerdown', onPointerDown, { label: `scrollbar:${key}:thumb-pointerdown` });
          bindingLifecycle.on(track, 'pointerdown', onTrackPointerDown, { label: `scrollbar:${key}:track-pointerdown` });
          bindingLifecycle.on(track, 'keydown', onKeyDown, { label: `scrollbar:${key}:track-keydown` });
          bindingLifecycle.add(() => binding.pointerDrag?.dispose(), `scrollbar:${key}:pointer-drag`);
          binding.cleanup = () => {
            if (binding.idleTimer) clearTimeout(binding.idleTimer);
            binding.idleTimer = null;
            bindingLifecycle.dispose();
          };
          return binding;
        };
        const resolveTargets = () => hddScrollTargets(document);
        const bindTargets = () => {
          const next = new Map(resolveTargets().map(({ key, target }) => [key, target]));
          bindings.forEach((binding, key) => {
            if (next.get(key) !== binding.target) {
              binding.cleanup();
              bindings.delete(key);
            }
          });
          next.forEach((target, key) => {
            if (!bindings.has(key)) bindings.set(key, createBinding(key, target));
          });
          resizeObserver?.disconnect();
          resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
          bindings.forEach((binding) => {
            resizeObserver?.observe(binding.target);
          });
          schedule();
        };
        const sync = () => {
          const measurements = [];
          bindings.forEach((binding) => {
            const target = binding.target;
            const rect = target.getBoundingClientRect();
            const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
            const visible = rect.width > 0 && rect.height > 0 && target.clientHeight > 0 && maxScroll > 1;
            if (!visible) {
              measurements.push({ binding, visible: false });
              return;
            }
            const trackHeight = Math.max(24, Math.round(rect.height - 4));
            const thumbHeight = Math.max(20, Math.min(trackHeight, Math.round(trackHeight * target.clientHeight / target.scrollHeight)));
            const travel = Math.max(0, trackHeight - thumbHeight);
            const thumbTop = maxScroll ? Math.round(target.scrollTop / maxScroll * travel) : 0;
            measurements.push({ binding, visible: true, rect, maxScroll, trackHeight, thumbHeight, thumbTop });
          });
          measurements.forEach(({ binding, visible, rect, maxScroll, trackHeight, thumbHeight, thumbTop }) => {
            if (!visible) {
              binding.track.setAttribute('data-visible', 'false');
              return;
            }
            // Keep the hit area and thumb inside the content edge so the thumb
            // remains easy to grab without touching the panel boundary.
            binding.track.style.left = `${Math.round(rect.right - EDGE_INSET - TRACK_WIDTH)}px`;
            binding.track.style.top = `${Math.round(rect.top + 2)}px`;
            binding.track.style.height = `${trackHeight}px`;
            binding.thumb.style.height = `${thumbHeight}px`;
            binding.thumb.style.transform = `translateY(${thumbTop}px)`;
            binding.track.setAttribute('data-visible', 'true');
            updateAria(binding.track, binding.target, maxScroll);
          });
        };

        bindTargets();
        if (typeof MutationObserver === 'function' && document.body) {
          structureObserver = createManagedMutationObserver((records) => {
            let targetStructureChanged = false;
            let targetContentChanged = false;
            records.forEach((record) => {
              if (record.type !== 'childList') return;
              const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
              if (target?.closest?.(HDD_SCROLL_TARGET_SELECTOR)) targetContentChanged = true;
              const nodes = [...record.addedNodes, ...record.removedNodes];
              if (nodes.some((node) => node.nodeType === 1 && (node.matches?.(HDD_SCROLL_TARGET_SELECTOR) || node.querySelector?.(HDD_SCROLL_TARGET_SELECTOR)))) targetStructureChanged = true;
            });
            bindings.forEach((binding) => {
              if (!binding.target.isConnected) targetStructureChanged = true;
            });
            if (targetStructureChanged) scheduleStructure();
            else if (targetContentChanged) schedule();
          });
          structureObserver.observe(document.body, { childList: true, subtree: true });
        }
        window.addEventListener('resize', schedule, { passive: true });
        const cleanup = () => {
          structureObserver?.disconnect();
          resizeObserver?.disconnect();
          window.removeEventListener('resize', schedule);
          bindings.forEach((binding) => binding.cleanup());
          bindings.clear();
          host.remove();
        };
        lifecycle.add(cleanup, 'scrollbars:dispose');
        return () => lifecycle.dispose();
      }, [enabled]);

      return null;
    }
  return { HddOverlayScrollbars };
}

module.exports = { install };

