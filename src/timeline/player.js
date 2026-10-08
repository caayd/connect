// The video element is the clock. This module exposes its position as a
// route-relative offset (ms) for consumers via currentOffset().
//
// An anchor ({offset, at, rate}) extrapolates between media events instead of
// reading el.currentTime directly: currentTime is quantized to frames, and on
// iOS with audio it reports unreliable values between timeupdate events.
// Resyncing on every event keeps extrapolation error under one interval.

let el = null;
let route = null;
let loop = null;         // { startTime, duration } route-ms
let anchor = null;       // { offset: ms, at: performance.now epoch, rate }

function syncAnchor(rate = null) {
  if (!el) return;
  anchor = {
    offset: el.currentTime * 1000 + (route?.videoStartOffset || 0),
    at: performance.now(),
    rate: rate === null ? (el.paused || el.seeking ? 0 : el.playbackRate) : rate,
  };
}

function wrapLoop(offset) {
  if (!loop || loop.startTime === null) {
    return offset;
  }
  const end = loop.startTime + loop.duration;
  if (offset < loop.startTime) {
    return loop.startTime;
  }
  if (offset >= end) {
    return ((offset - loop.startTime) % loop.duration) + loop.startTime;
  }
  return offset;
}

function applyOffsetToElement(offsetMs) {
  if (el) {
    el.currentTime = Math.max(0, (offsetMs - (route?.videoStartOffset || 0)) / 1000);
    syncAnchor();
  }
  anchor = { offset: offsetMs, at: performance.now(), rate: anchor?.rate ?? 0 };
}

// timeupdate fires during playback, so loop wrap happens here rather than
// waiting for 'ended' (which only fires at the end of the whole stream)
function enforceLoop() {
  if (!el || !loop || loop.startTime === null) {
    syncAnchor();
    return;
  }
  const offset = el.currentTime * 1000 + (route?.videoStartOffset || 0);
  const end = loop.startTime + loop.duration;
  if (offset >= end) {
    applyOffsetToElement(loop.startTime + ((offset - end) % loop.duration));
  } else if (offset < loop.startTime) {
    applyOffsetToElement(loop.startTime);
  } else {
    syncAnchor();
  }
}

// Commands must reach the clock even while the element is detached (map view,
// before DriveVideo mounts). DriveVideo also applies them via props; both
// paths write the same anchor so double-application is a no-op.
export function bindStore(store) {
  let prev = store.getState();
  setLoop(prev.loop);
  return store.subscribe(() => {
    const state = store.getState();

    if (state.loop !== prev.loop) {
      setLoop(state.loop);
      const offset = playerOffset();
      if (offset !== null && offset !== wrapLoop(offset)) {
        seekVideo(offset);
      }
    }
    if (state.offset !== prev.offset && state.offset !== null && state.offset !== undefined) {
      seekVideo(state.offset);
    }
    if (state.desiredPlaySpeed !== prev.desiredPlaySpeed && anchor) {
      anchor.rate = state.desiredPlaySpeed || 0;
    }
    prev = state;
  });
}

export function attachVideoElement(videoEl, currentRoute) {
  route = currentRoute;
  el = videoEl;

  const update = () => syncAnchor();
  const freeze = () => syncAnchor(0);
  const resume = () => syncAnchor();
  const wrap = () => enforceLoop();

  const handlers = { update, freeze, resume, wrap };
  el.addEventListener('timeupdate', wrap);
  el.addEventListener('seeked', update);
  el.addEventListener('play', update);
  el.addEventListener('pause', freeze);
  el.addEventListener('waiting', freeze);
  el.addEventListener('stalled', freeze);
  el.addEventListener('playing', resume);
  el.addEventListener('ratechange', resume);
  el.addEventListener('ended', wrap);
  el.__playbackHandlers = handlers;

  syncAnchor();
}

export function detachVideoElement() {
  if (el?.__playbackHandlers) {
    const { update, freeze, resume, wrap } = el.__playbackHandlers;
    el.removeEventListener('timeupdate', wrap);
    el.removeEventListener('seeked', update);
    el.removeEventListener('play', update);
    el.removeEventListener('pause', freeze);
    el.removeEventListener('waiting', freeze);
    el.removeEventListener('stalled', freeze);
    el.removeEventListener('playing', resume);
    el.removeEventListener('ratechange', resume);
    el.removeEventListener('ended', wrap);
    delete el.__playbackHandlers;
  }
  // anchor survives detach so map/clock keep advancing without the element
  if (el && anchor) {
    anchor = { offset: playerOffset(), at: performance.now(), rate: anchor.rate };
  }
  el = null;
}

export function setRoute(currentRoute) {
  route = currentRoute;
}

export function setLoop(newLoop) {
  loop = newLoop;
}

// current route offset in ms, or null when nothing has ever been played
export function playerOffset() {
  if (!anchor) {
    return loop && loop.startTime !== null ? loop.startTime : null;
  }
  return wrapLoop(anchor.offset + (performance.now() - anchor.at) * anchor.rate);
}

export function seekVideo(offsetMs) {
  applyOffsetToElement(wrapLoop(offsetMs));
}

export function videoElement() {
  return el;
}
