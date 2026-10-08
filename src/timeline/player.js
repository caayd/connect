// The video element is the clock.
//
// This module translates between the media element's timeline (seconds since
// the start of the HLS stream) and route time (milliseconds since the start
// of the drive). Components that need the current route offset call
// `currentOffset()` from src/timeline/index.js, which delegates here.
//
// Why an anchor instead of reading el.currentTime directly:
// - el.currentTime is quantized to frames; consumers render every rAF tick and
//   need a smooth position (ruler, map marker, clock).
// - On iOS with audio in the stream, currentTime reports unreliable values
//   between timeupdate events, so we extrapolate between events.
//
// The anchor is re-synced on every meaningful media event (timeupdate, seeked,
// playing, ratechange, waiting, ...) so extrapolation error stays bounded to
// one timeupdate interval (~250ms) at most, and is corrected immediately.

let el = null;           // the attached <video> element, or null
let route = null;        // currentRoute; provides videoStartOffset + duration
let loop = null;         // { startTime, duration } route-ms; set by DriveVideo

// Playback anchor in route time. `offset` was correct at `at` (performance.now
// epoch) and advances at `rate` (0 while paused/buffering/detached).
let anchor = null;       // { offset: number (ms), at: number (ms), rate: number }

function syncAnchor(rate = null) {
  if (!el) return;
  const r = rate === null ? (el.paused || el.seeking ? 0 : el.playbackRate) : rate;
  anchor = {
    offset: el.currentTime * 1000 + (route?.videoStartOffset || 0),
    at: performance.now(),
    rate: r,
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

// DriveVideo calls this once per mounted video element.
export function attachVideoElement(videoEl, currentRoute) {
  route = currentRoute;
  el = videoEl;

  const update = () => syncAnchor();
  const freeze = () => syncAnchor(0);     // waiting/stalled: clock stops with media
  const resume = () => syncAnchor();      // playing/ratechange: clock resumes at media rate
  const wrap = () => {
    // enforce the loop without waiting for a redux round-trip
    const offset = playerOffset();
    if (offset !== null && loop && loop.startTime !== null) {
      const end = loop.startTime + loop.duration;
      if (offset >= end || offset < loop.startTime) {
        applyOffsetToElement(wrapLoop(offset));
      } else {
        syncAnchor();
      }
    }
  };

  const handlers = { update, freeze, resume, wrap };
  el.addEventListener('timeupdate', update);
  el.addEventListener('seeked', update);
  el.addEventListener('play', update);
  el.addEventListener('pause', freeze);
  el.addEventListener('waiting', freeze);
  el.addEventListener('stalled', freeze);
  el.addEventListener('playing', resume);
  el.addEventListener('ratechange', resume);
  el.addEventListener('ended', wrap);
  el.__playbackHandlers = handlers;

  // seed the anchor with the element's initial position
  syncAnchor();
}

export function detachVideoElement() {
  if (el?.__playbackHandlers) {
    const { update, freeze, resume, wrap } = el.__playbackHandlers;
    el.removeEventListener('timeupdate', update);
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
  // keep the anchor alive: with the element gone (map view, route switch) the
  // timeline continues from the last known position so the map/clock don't
  // freeze or reset
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
  const raw = anchor.offset + (performance.now() - anchor.at) * anchor.rate;
  return wrapLoop(raw);
}

function applyOffsetToElement(offsetMs) {
  const videoTime = Math.max(0, (offsetMs - (route?.videoStartOffset || 0)) / 1000);
  if (el) {
    el.currentTime = videoTime;
    syncAnchor();
  }
  anchor = { offset: offsetMs, at: performance.now(), rate: anchor?.rate ?? 0 };
}

// Command: seek the playback clock to a route offset (ms). Works while the
// element is detached too — the anchor keeps position and the next attach
// applies it via DriveVideo's prop handling.
export function seekVideo(offsetMs) {
  applyOffsetToElement(wrapLoop(offsetMs));
}

export function videoElement() {
  return el;
}
