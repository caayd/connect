import { playerOffset } from './player';

/**
 * Get current playback offset in route-relative milliseconds.
 *
 * The video element is the clock: this reads the playback position maintained
 * by src/timeline/player.js, falling back to the last redux-commanded offset
 * while no video has attached yet.
 *
 * @param {object} state redux state (fallback source of the commanded offset)
 * @returns {number}
 */
export function currentOffset(state = null) {
  const offset = playerOffset();
  if (offset !== null) {
    return offset;
  }
  return (state && state.offset) || 0;
}
