import { pause, play, reducer, resetPlayback, seek, selectLoop } from './playback';

const makeDefaultStruct = function makeDefaultStruct() {
  return {
    desiredPlaySpeed: 1, // 0 = stopped, 1 = playing, 2 = 2x speed
    offset: 0, // in miliseconds from the start
    loop: null,
  };
};

describe('playback', () => {
  it('stores pause and play commands without mutating the offset', () => {
    let state = makeDefaultStruct();
    state.offset = 123;

    state = reducer(state, pause());
    expect(state.desiredPlaySpeed).toEqual(0);
    expect(state.offset).toEqual(123);

    state = reducer(state, play(0.5));
    expect(state.desiredPlaySpeed).toEqual(0.5);
    expect(state.offset).toEqual(123);

    state = reducer(state, play(2));
    expect(state.desiredPlaySpeed).toEqual(2);
    expect(state.offset).toEqual(123);
  });

  it('stores a seek target', () => {
    const state = reducer(makeDefaultStruct(), seek(123));

    expect(state.offset).toEqual(123);
  });

  it('clamps a seek after the loop end', () => {
    let state = reducer(makeDefaultStruct(), selectLoop(1000, 2000));

    state = reducer(state, seek(3000));

    expect(state.loop.startTime).toEqual(1000);
    expect(state.offset).toEqual(2000);
  });

  it('clamps a seek before the loop start', () => {
    let state = reducer(makeDefaultStruct(), selectLoop(1000, 2000));

    state = reducer(state, seek(0));

    expect(state.loop.startTime).toEqual(1000);
    expect(state.offset).toEqual(1000);
  });

  it('updates and clears the loop', () => {
    let state = reducer(makeDefaultStruct(), selectLoop(1000, 2000));
    expect(state.loop).toEqual({ startTime: 1000, duration: 1000 });

    state = reducer(state, selectLoop(null, null));

    expect(state.loop).toEqual(null);
  });

  it('resets the offset and playback speed', () => {
    let state = {
      ...makeDefaultStruct(),
      desiredPlaySpeed: 0.5,
      offset: 123,
    };

    state = reducer(state, resetPlayback());

    expect(state.desiredPlaySpeed).toEqual(1);
    expect(state.offset).toEqual(0);
  });
});
