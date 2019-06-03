﻿import { ReactNativeDeviceApi } from './ReactNativeDeviceApi';
import { ReactNativeMediaPeer } from './ReactNativeMediaPeer';
import { ReactNativeMediaStream } from './ReactNativeMediaStream';
import {
  IMediaNetwork,
  MediaConfigurationState,
  MediaEvent,
  MediaEventType
  } from '../media/IMediaNetwork';
import { MediaConfig } from '../media/MediaConfig';
import { NetworkConfig } from '../media/NetworkConfig';
import { IFrameData } from '../media/RawFrame';
import {
  ConnectionId,
  IBasicNetwork,
  LocalNetwork,
  Queue,
  SignalingConfig,
  SLog,
  WebRtcDataPeer,
  WebRtcNetwork,
  WebsocketNetwork
  } from '../network/index';

/*
Copyright (c) 2019, because-why-not.com Limited
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


/**Avoid using this class directly whenever possible. Use ReactNativeWebRtcCall instead. 
 * ReactNativeMediaNetwork might be subject to frequent changes to keep up with changes
 * in all other platforms.  
 * 
 * IMediaNetwork implementation for the ReactNative. The class is mostly identical with the
 * C# version. Main goal is to have an interface that can easily be wrapped to other
 * programming languages and gives access to basic WebRTC features such as receiving
 * and sending audio and video + signaling via websockets. 
 * 
 * ReactNativeMediaNetwork can be used to stream a local audio and video track to a group of 
 * multiple peers and receive remote tracks. The handling of the peers itself
 * remains the same as WebRtcNetwork.
 * Local tracks are created after calling Configure. This will request access from the
 * user. After the user allowed access GetConfigurationState will return Configured.
 * Every incoming and outgoing peer that is established after this will receive
 * the local audio and video track. 
 * So far Configure can only be called once before any peers are connected.
 * 
 * 
 */
export class ReactNativeMediaNetwork extends WebRtcNetwork implements IMediaNetwork {

  //media configuration set by the user
  private mMediaConfig: MediaConfig = null;
  //keeps track of audio / video tracks based on local devices
  //will be shared with all connected peers.
  private mLocalStream: ReactNativeMediaStream = null;
  private mConfigurationState: MediaConfigurationState = MediaConfigurationState.Invalid;
  private mConfigurationError: string = null;
  private mMediaEvents: Queue<MediaEvent> = new Queue<MediaEvent>();

  constructor(config: NetworkConfig) {

    super(ReactNativeMediaNetwork.BuildSignalingConfig(config.SignalingUrl),
      ReactNativeMediaNetwork.BuildRtcConfig(config.IceServers));
    this.mConfigurationState = MediaConfigurationState.NoConfiguration;
  }


  /**Triggers the creation of a local audio and video track. After this
   * call the user might get a request to allow access to the requested 
   * devices.
   * 
   * @param config Detail configuration for audio/video devices.
   */
  public Configure(config: MediaConfig): void {
    this.mMediaConfig = config;
    this.mConfigurationError = null;
    this.mConfigurationState = MediaConfigurationState.InProgress;



    if (config.Audio || config.Video) {

      //ugly part starts -> call get user media data (no typescript support)
      //different ReactNatives have different calls...

      //check  getSupportedConstraints()??? 
      //see https://w3c.github.io/mediacapture-main/getusermedia.html#constrainable-interface

      //set default ideal to very common low 320x240 to avoid overloading weak computers
      var constraints = {
        audio: config.Audio
      } as any;



      let width = {} as any;
      let height = {} as any;
      let video = {} as any;
      let fps = {} as any;

      if (config.MinWidth != -1)
        width.min = config.MinWidth;

      if (config.MaxWidth != -1)
        width.max = config.MaxWidth;

      if (config.IdealWidth != -1)
        width.ideal = config.IdealWidth;

      if (config.MinHeight != -1)
        height.min = config.MinHeight;

      if (config.MaxHeight != -1)
        height.max = config.MaxHeight;

      if (config.IdealHeight != -1)
        height.ideal = config.IdealHeight;


      if (config.MinFps != -1)
        fps.min = config.MinFps;
      if (config.MaxFps != -1)
        fps.max = config.MaxFps;
      if (config.IdealFps != -1)
        fps.ideal = config.IdealFps;


      //user requested specific device? get it now to properly add it to the
      //constraints later
      let deviceId: string = null;
      if (config.Video && config.VideoDeviceName && config.VideoDeviceName !== "") {
        deviceId = ReactNativeDeviceApi.GetDeviceId(config.VideoDeviceName);
        SLog.L("using device " + config.VideoDeviceName);
        if (deviceId !== null) {
          //SLog.L("using device id " + deviceId);
        }
        else {
          SLog.LE("Failed to find deviceId for label " + config.VideoDeviceName);
        }
      }
      //watch out: unity changed behaviour and will now
      //give 0 / 1 instead of false/true
      //using === won't work
      if (config.Video == false) {
        //video is off
        video = false;
      } else {
        if (Object.keys(width).length > 0) {
          video.width = width;
        }
        if (Object.keys(height).length > 0) {
          video.height = height;
        }
        if (Object.keys(fps).length > 0) {
          video.frameRate = fps;
        }
        if (deviceId !== null) {
          video.deviceId = { "exact": deviceId };
        }

        //if we didn't add anything we need to set it to true
        //at least (I assume?)
        if (Object.keys(video).length == 0) {
          video = true;
        }
      }


      constraints.video = video;

      SLog.L("calling GetUserMedia. Media constraints: " + JSON.stringify(constraints));
      if (navigator && navigator.mediaDevices) {
        let promise = navigator.mediaDevices.getUserMedia(constraints);
        promise.then((stream) => { //user gave permission

          //totally unrelated -> user gave access to devices. use this
          //to get the proper names for our ReactNativeDeviceApi
          ReactNativeDeviceApi.Update();

          //call worked -> setup a frame buffer that deals with the rest
          this.mLocalStream = new ReactNativeMediaStream(stream as MediaStream);
          this.mLocalStream.InternalStreamAdded = (stream) => {
            this.EnqueueMediaEvent(MediaEventType.StreamAdded, ConnectionId.INVALID, this.mLocalStream.VideoElement);
          };

          //unlike native version this one will happily play the local sound causing an echo
          //set to mute
          this.mLocalStream.SetMute(true);
          this.OnConfigurationSuccess();

        });
        promise.catch((err) => {
          //failed due to an error or user didn't give permissions
          SLog.LE(err.name + ": " + err.message);
          this.OnConfigurationFailed(err.message);
        });
      } else {
        //no access to media device -> fail
        let error = "Configuration failed. navigator.mediaDevices is unedfined. The ReactNative might not allow media access." +
          "Is the page loaded via http or file URL? Some ReactNatives only support https!";
        SLog.LE(error);
        this.OnConfigurationFailed(error);
      }
    } else {
      this.OnConfigurationSuccess();
    }
  }



  /**Call this every time a new frame is shown to the user in realtime
   * applications.
   * 
   */
  public Update(): void {
    super.Update();

    if (this.mLocalStream != null)
      this.mLocalStream.Update();
  }

  private EnqueueMediaEvent(type: MediaEventType, id: ConnectionId, args: HTMLVideoElement) {
    let evt = new MediaEvent(type, id, args);
    this.mMediaEvents.Enqueue(evt);
  }
  public DequeueMediaEvent(): MediaEvent {
    return this.mMediaEvents.Dequeue();
  }
  /**
   * Call this every frame after interacting with this instance.
   * 
   * This call might flush buffered messages in the future and clear
   * events that the user didn't process to avoid buffer overflows.
   * 
   */
  public Flush(): void {
    super.Flush();
    this.mMediaEvents.Clear();
  }

  /**Poll this after Configure is called to get the result.
   * Won't change after state is Configured or Failed.
   * 
   */
  public GetConfigurationState(): MediaConfigurationState {
    return this.mConfigurationState;
  }

  /**Returns the error message if the configure process failed.
   * This usally either happens because the user refused access
   * or no device fulfills the configuration given 
   * (e.g. device doesn't support the given resolution)
   * 
   */
  public GetConfigurationError(): string {
    return this.mConfigurationError;
  }

  /**Resets the configuration state to allow multiple attempts
   * to call Configure. 
   * 
   */
  public ResetConfiguration(): void {
    this.mConfigurationState = MediaConfigurationState.NoConfiguration;
    this.mMediaConfig = new MediaConfig();
    this.mConfigurationError = null;
  }
  private OnConfigurationSuccess(): void {
    this.mConfigurationState = MediaConfigurationState.Successful;
  }

  private OnConfigurationFailed(error: string): void {
    this.mConfigurationError = error;
    this.mConfigurationState = MediaConfigurationState.Failed;
  }

  /**Allows to peek at the current frame.
   * Added to allow the emscripten C / C# side to allocate memory before
   * actually getting the frame.
   * 
   * @param id 
   */
  public PeekFrame(id: ConnectionId): IFrameData {

    if (id == null)
      return;

    if (id.id == ConnectionId.INVALID.id) {
      if (this.mLocalStream != null) {
        return this.mLocalStream.PeekFrame();
      }
    } else {
      let peer = this.IdToConnection[id.id] as ReactNativeMediaPeer;
      if (peer != null) {
        return peer.PeekFrame();
      }
      //TODO: iterate over media peers and do the same as above
    }

    return null;
  }
  public TryGetFrame(id: ConnectionId): IFrameData {

    if (id == null)
      return;

    if (id.id == ConnectionId.INVALID.id) {
      if (this.mLocalStream != null) {
        return this.mLocalStream.TryGetFrame();
      }
    } else {
      let peer = this.IdToConnection[id.id] as ReactNativeMediaPeer;
      if (peer != null) {
        return peer.TryGetRemoteFrame();
      }
      //TODO: iterate over media peers and do the same as above
    }

    return null;
  }

  /**
   * Remote audio control for each peer. 
   * 
   * @param volume 0 - mute and 1 - max volume
   * @param id peer id
   */
  public SetVolume(volume: number, id: ConnectionId): void {

    SLog.L("SetVolume called. Volume: " + volume + " id: " + id.id);
    let peer = this.IdToConnection[id.id] as ReactNativeMediaPeer;
    if (peer != null) {
      return peer.SetVolume(volume);
    }
  }
  /** Allows to check if a specific peer has a remote
   * audio track attached. 
   * 
   * @param id 
   */
  public HasAudioTrack(id: ConnectionId): boolean {
    let peer = this.IdToConnection[id.id] as ReactNativeMediaPeer;
    if (peer != null) {
      return peer.HasAudioTrack();
    }
    return false;
  }
  /** Allows to check if a specific peer has a remote
   * video track attached. 
   * 
   * @param id 
   */
  public HasVideoTrack(id: ConnectionId): boolean {
    let peer = this.IdToConnection[id.id] as ReactNativeMediaPeer;
    if (peer != null) {
      return peer.HasVideoTrack();
    }
    return false;
  }
  /**Returns true if no local audio available or it is muted. 
   * False if audio is available (could still not work due to 0 volume, hardware
   * volume control or a dummy audio input device is being used)
   */
  public IsMute(): boolean {

    if (this.mLocalStream != null && this.mLocalStream.Stream != null) {
      var stream = this.mLocalStream.Stream;
      var tracks = stream.getAudioTracks();
      if (tracks.length > 0) {
        if (tracks[0].enabled)
          return false;
      }
    }
    return true;
  }

  /**Sets the local audio device to mute / unmute it.
   * 
   * @param value 
   */
  public SetMute(value: boolean) {
    if (this.mLocalStream != null && this.mLocalStream.Stream != null) {
      var stream = this.mLocalStream.Stream;
      var tracks = stream.getAudioTracks();
      if (tracks.length > 0) {
        tracks[0].enabled = !value;
      }
    }
  }
  protected CreatePeer(peerId: ConnectionId, lRtcConfig: RTCConfiguration): WebRtcDataPeer {
    let peer = new ReactNativeMediaPeer(peerId, lRtcConfig);
    peer.InternalStreamAdded = this.ReactNativeMediaPeer_InternalMediaStreamAdded;
    if (this.mLocalStream != null)
      peer.AddLocalStream(this.mLocalStream.Stream);

    return peer;
  }

  private ReactNativeMediaPeer_InternalMediaStreamAdded = (peer: ReactNativeMediaPeer, stream: ReactNativeMediaStream): void => {
    this.EnqueueMediaEvent(MediaEventType.StreamAdded, peer.ConnectionId, stream.VideoElement);
  }

  protected DisposeInternal(): void {
    super.DisposeInternal();
    this.DisposeLocalStream();
  }

  private DisposeLocalStream(): void {
    if (this.mLocalStream != null) {
      this.mLocalStream.Dispose();
      this.mLocalStream = null;
      SLog.L("local buffer disposed");
    }
  }

  private static BuildSignalingConfig(signalingUrl: string): SignalingConfig {

    let signalingNetwork: IBasicNetwork;
    if (signalingUrl == null || signalingUrl == "") {
      signalingNetwork = new LocalNetwork();
    } else {
      signalingNetwork = new WebsocketNetwork(signalingUrl);
    }
    return new SignalingConfig(signalingNetwork);
  }

  private static BuildRtcConfig(servers: RTCIceServer[]): RTCConfiguration {

    let rtcConfig: RTCConfiguration = { iceServers: servers };
    return rtcConfig;
  }
}
