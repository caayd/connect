/* eslint-disable camelcase */
import React, { Component } from 'react';
import { connect } from 'react-redux';
import Hls from 'hls.js';
import { CircularProgress, Typography } from '@material-ui/core';

import { api } from '../../api/backend';

import Colors from '../../colors';
import { ErrorOutline } from '../../icons';
import * as player from '../../timeline/player';

const VIDEO_NETWORK_ERROR = 'Unable to load video. Check network connection.';
const VIDEO_NOT_FOUND_ERROR = 'This video segment has not uploaded yet or has been deleted.';
const VIDEO_ERROR = 'Unable to load video';

const VideoOverlay = ({ loading, error }) => {
  let content;
  if (error) {
    content = (
      <>
        <ErrorOutline className="mb-2" />
        <Typography>{error}</Typography>
      </>
    );
  } else if (loading) {
    content = <CircularProgress style={{ color: Colors.white }} thickness={4} size={50} />;
  } else {
    return null;
  }
  return (
    <div className="z-50 absolute h-full w-full bg-[#16181AAA]">
      <div className="relative text-center top-[calc(50%_-_25px)]">
        {content}
      </div>
    </div>
  );
};

class DriveVideo extends Component {
  constructor(props) {
    super(props);

    this.videoRef = React.createRef();
    this.hls = null;
    this.src = '';
    this.pendingSeek = false;

    this.state = {
      src: '',
      isBuffering: true,
      videoError: null,
    };

    this.onHlsError = this.onHlsError.bind(this);
    this.onVideoError = this.onVideoError.bind(this);
    this.onVideoWaiting = this.onVideoWaiting.bind(this);
    this.onVideoSeeking = this.onVideoSeeking.bind(this);
    this.onVideoPlaying = this.onVideoPlaying.bind(this);
    this.onLoadedMetadata = this.onLoadedMetadata.bind(this);
    this.onCanPlay = this.onCanPlay.bind(this);
  }

  componentDidMount() {
    const { currentRoute, loop, offset } = this.props;
    const video = this.videoRef.current;
    if (video) {
      player.attachVideoElement(video, currentRoute);
    }
    player.setRoute(currentRoute);
    player.setLoop(loop);
    this.setVideoSource(currentRoute);
    if (offset !== null && offset !== undefined) {
      this.seek(offset);
    }
    this.applyPlayback(this.props);
  }

  componentDidUpdate(prevProps) {
    const { currentRoute, loop, offset } = this.props;
    const routeChanged = prevProps.currentRoute?.fullname !== currentRoute?.fullname;

    player.setRoute(currentRoute);
    player.setLoop(loop);

    if (routeChanged) {
      const video = this.videoRef.current;
      if (video) {
        player.detachVideoElement();
        player.attachVideoElement(video, currentRoute);
      }
      this.setState({ videoError: null });
      this.setVideoSource(currentRoute);
      if (offset !== null && offset !== undefined) {
        this.seek(offset);
      }
    } else if (offset !== prevProps.offset && offset !== null && offset !== undefined) {
      this.seek(offset);
    }

    if (routeChanged || this.props.desiredPlaySpeed !== prevProps.desiredPlaySpeed) {
      this.applyPlayback(this.props);
    }
  }

  componentWillUnmount() {
    this.destroyHls();
    player.detachVideoElement();
  }

  setVideoSource(currentRoute) {
    const src = currentRoute
      ? api.video.getQcameraStreamUrl(currentRoute.fullname, currentRoute.share_exp, currentRoute.share_sig)
      : '';
    if (src === this.src) return;

    this.src = src;
    this.destroyHls();
    this.setState({ src, videoError: null });

    const video = this.videoRef.current;
    if (!video || !src) {
      if (video) video.removeAttribute('src');
      return;
    }

    if (Hls.isSupported()) {
      video.removeAttribute('src');
      this.hls = new Hls({ maxBufferLength: 40 });
      this.hls.on(Hls.Events.ERROR, this.onHlsError);
      this.hls.on(Hls.Events.BUFFER_CODECS || 'hlsBufferCodecs', (_event, data) => {
        if (this.props.onAudioStatusChange) {
          this.props.onAudioStatusChange(Boolean(data?.audio));
        }
      });
      this.hls.loadSource(src);
      this.hls.attachMedia(video);
    } else {
      video.src = src;
    }
  }

  destroyHls() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  seek(offset) {
    this.pendingSeek = true;
    player.seekVideo(offset);
  }

  applyPlayback(props) {
    const video = this.videoRef.current;
    if (!video) return;

    const speed = props.desiredPlaySpeed || 0;
    try {
      video.playbackRate = speed;
    } catch (error) {
      // Some media implementations reject unsupported playback rates.
    }

    if (!props.currentRoute || speed === 0) {
      try {
        video.pause();
      } catch (error) {
        // The element may have been detached while changing routes.
      }
      return;
    }

    try {
      const playResult = video.play();
      if (playResult?.catch) {
        playResult.catch(() => {
          // Autoplay can be rejected when the video is unmuted. It remains paused.
        });
      }
    } catch (error) {
      // Treat synchronous autoplay failures the same as rejected play promises.
    }
  }

  onVideoWaiting() {
    this.setState({ isBuffering: true });
  }

  onVideoSeeking() {
    this.setState({ isBuffering: true });
  }

  onVideoPlaying() {
    this.setState({ isBuffering: false, videoError: null });
  }

  onLoadedMetadata() {
    const video = this.videoRef.current;
    if (video?.audioTracks !== undefined && this.props.onAudioStatusChange) {
      this.props.onAudioStatusChange(Boolean(video.audioTracks?.length));
    }
    this.reapplyPendingSeek();
    this.setState({ isBuffering: false });
  }

  onCanPlay() {
    this.reapplyPendingSeek();
    this.setState({ isBuffering: false });
  }

  reapplyPendingSeek() {
    const { currentRoute, offset } = this.props;
    if (!this.pendingSeek || offset === null || offset === undefined) return;

    const desiredTime = Math.max(0, (offset - (currentRoute?.videoStartOffset || 0)) / 1000);
    const video = this.videoRef.current;
    if (!video || Math.abs(video.currentTime - desiredTime) > 0.01) {
      player.seekVideo(offset);
    }
    this.pendingSeek = false;
  }

  onHlsError(_event, data) {
    if (!data) return;
    if (!data.fatal) {
      if (data.details === 'bufferStalledError' || data.details === 'bufferNudgeOnStall') {
        this.setState({ isBuffering: true });
      }
      return;
    }

    if (data.type === 'networkError' && (data.response?.code === 404 || data.response?.status === 404)) {
      this.setState({ videoError: VIDEO_NOT_FOUND_ERROR });
    } else {
      this.setState({ videoError: VIDEO_ERROR });
    }
  }

  onVideoError(event) {
    const error = event?.currentTarget?.error;
    if (!error) return;

    if (error.code === error.MEDIA_ERR_NETWORK || error.code === 2) {
      this.setState({ videoError: VIDEO_NETWORK_ERROR });
    } else if (error.code === error.MEDIA_ERR_SRC_NOT_SUPPORTED || error.code === 4) {
      this.setState({ videoError: VIDEO_NOT_FOUND_ERROR });
    } else {
      this.setState({ videoError: VIDEO_ERROR });
    }
  }

  render() {
    const { isMuted } = this.props;
    const { src, isBuffering, videoError } = this.state;
    const hlsSource = Boolean(this.hls);

    return (
      <div className="min-h-[200px] relative max-w-[964px] m-[0_auto] aspect-[1.593]">
        <VideoOverlay loading={isBuffering} error={videoError} />
        <video
          ref={this.videoRef}
          src={hlsSource ? undefined : src || undefined}
          muted={isMuted}
          playsInline
          width="100%"
          height="100%"
          onWaiting={this.onVideoWaiting}
          onSeeking={this.onVideoSeeking}
          onPlaying={this.onVideoPlaying}
          onCanPlay={this.onCanPlay}
          onLoadedMetadata={this.onLoadedMetadata}
        />
      </div>
    );
  }
}

const stateToProps = (state) => ({
  desiredPlaySpeed: state.desiredPlaySpeed,
  offset: state.offset,
  loop: state.loop,
  currentRoute: state.currentRoute,
});

export default connect(stateToProps)(DriveVideo);
