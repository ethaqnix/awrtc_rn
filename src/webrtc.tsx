import * as React from 'react';
import { Button } from 'react-native';
import * as awrtc from './awrtc/index';

interface SelfProps {
};

interface SelfState {

};

interface StateFromProps {
}

interface DispatchProps {
}


type Props = SelfProps & StateFromProps & DispatchProps;

class Communication extends React.Component<Props, SelfState> {
  mNetConfig: awrtc.NetworkConfig = new awrtc.NetworkConfig();
  mCall: awrtc.BrowserWebRtcCall | null = null;
  mIntervalId: any = -1;
  mLocalVideo = null;
  mRemoteVideo = {};
  mIsRunning = false;
  mAddress = 'KORJXWP';
  mAudio;
  mVideo;

  constructor(props: Props) {
    super(props);
    this.mNetConfig.IceServers = [
      { urls: "stun:stun.because-why-not.com:443" },
      { urls: "stun:stun.l.google.com:19302" }
    ];
    //use for testing conferences
    //this.mNetConfig.IsConference = true;
    //this.mNetConfig.SignalingUrl = "wss://signaling.because-why-not.com/testshared";
    this.mNetConfig.IsConference = false;
    this.mNetConfig.SignalingUrl = "wss://signaling.because-why-not.com/callapp";
  }

  Start(address, audio, video) {
    if (this.mCall !== null)
      this.Stop();
    this.mIsRunning = true;
    console.log("start");
    console.log("Using signaling server url: " + this.mNetConfig.SignalingUrl);
    //create media configuration
    var config = new awrtc.MediaConfig();
    config.Audio = audio;
    config.Video = video;
    config.IdealWidth = 640;
    config.IdealHeight = 480;
    config.IdealFps = 30;
    //For usage in HTML set FrameUpdates to false and wait for  MediaUpdate to
    //get the VideoElement. By default awrtc would deliver frames individually
    //for use in Unity WebGL
    console.log("requested config:" + JSON.stringify(config));
    //setup our high level call class.
    this.mCall = new awrtc.BrowserWebRtcCall(this.mNetConfig);
    //handle events (get triggered after Configure / Listen call)
    //+ugly lambda to avoid loosing "this" reference
    this.mCall.addEventListener((sender, args) => {
      this.OnNetworkEvent(sender, args);
    });
    //As the system is designed for realtime graphics we have to call the Update method. Events are only
    //triggered during this Update call!
    this.mIntervalId = setInterval(() => {
      this.Update();
    }, 50);
    //configure media. This will request access to media and can fail if the user doesn't have a proper device or
    //blocks access
    this.mCall.Configure(config);
    //Try to listen to the address
    //Conference mode = everyone listening will connect to each other
    //Call mode -> If the address is free it will wait for someone else to connect
    //          -> If the address is used then it will fail to listen and then try to connect via Call(address);
    this.mCall.Listen(address);
  }

  Stop() {
    this.Cleanup();
  }

  Cleanup() {
    if (this.mCall !== null) {
      this.mCall!.Dispose();
      this.mCall = null;
      clearInterval(this.mIntervalId);
      this.mIntervalId = -1;
      this.mIsRunning = false;
      this.mLocalVideo = null;
      this.mRemoteVideo = {};
    }
  }

  Update() {
    console.log('UPDATE');
    if (this.mCall !== null)
      this.mCall.Update();
  }

  OnNetworkEvent(sender, args) {
    console.log(sender);
    console.log(args);
    //User gave access to requested camera/ microphone
    if (args.Type == awrtc.CallEventType.ConfigurationComplete) {
      console.log("configuration complete");
    }
    else if (args.Type == awrtc.CallEventType.MediaUpdate) {
      let margs = args;
      if (this.mLocalVideo == null && margs.ConnectionId == awrtc.ConnectionId.INVALID) {
        var videoElement = margs.VideoElement;
        this.mLocalVideo = videoElement;
        console.log("local video added resolution:" + videoElement.videoWidth + videoElement.videoHeight + " fps: ??");
      }
      else if (margs.ConnectionId != awrtc.ConnectionId.INVALID && this.mRemoteVideo[margs.ConnectionId.id] == null) {
        var videoElement = margs.VideoElement;
        this.mRemoteVideo[margs.ConnectionId.id] = videoElement;
        console.log("remote video added resolution:" + videoElement.videoWidth + videoElement.videoHeight + " fps: ??");
      }
    }
    else if (args.Type == awrtc.CallEventType.ListeningFailed) {
      //First attempt of this example is to try to listen on a certain address
      //for conference calls this should always work (expect the internet is dead)
      if (this.mNetConfig.IsConference == false) {
        //no conference call and listening failed? someone might have claimed the address.
        //Try to connect to existing call
        this.mCall!.Call(this.mAddress);
      }
      else {
        let errorMsg = "Listening failed. Offline? Server dead?";
        console.error(errorMsg);
        this.Cleanup();
        return;
      }
    }
    else if (args.Type == awrtc.CallEventType.ConnectionFailed) {
      //Outgoing call failed entirely. This can mean there is no address to connect to,
      //server is offline, internet is dead, firewall blocked access, ...
      let errorMsg = "Connection failed. Offline? Server dead? ";
      console.error(errorMsg);
      this.Cleanup();
      return;
    }
    else if (args.Type == awrtc.CallEventType.CallEnded) {
      //call ended or was disconnected
      var callEndedEvent = args;
      console.log("call ended with id " + callEndedEvent.ConnectionId.id);
      delete this.mRemoteVideo[callEndedEvent.ConnectionId.id];
      //check if this was the last user
      if (this.mNetConfig.IsConference == false && Object.keys(this.mRemoteVideo).length == 0) {
        //1 to 1 call and only user left -> quit
        this.Cleanup();
        return;
      }
    }
    else if (args.Type == awrtc.CallEventType.Message) {
      //no ui for this yet. simply echo messages for testing
      let messageArgs = args;
      this.mCall!.Send(messageArgs.Content, messageArgs.Reliable, messageArgs.ConnectionId);
    }
    else if (args.Type == awrtc.CallEventType.DataMessage) {
      //no ui for this yet. simply echo messages for testing
      let messageArgs = args;
      this.mCall!.SendData(messageArgs.Content, messageArgs.Reliable, messageArgs.ConnectionId);
    }
    else {
      console.log("Unhandled event: " + args.Type);
    }
  }

  GetUrlParams() {
    return "?a=" + this.mAddress + "&audio=" + /*this.mAudio*/'true' + "&video=" + /*this.mVideo*/'false' + "&" + "autostart=" + true;
  }
  GetUrl() {
    return 'https://www.because-why-not.com/files/awrtc0983rc2/?a=KORJXWP&audio=true&video=false&autostart=true';
  }

  componentDidMount() {
  }

  render() {
    console.log(this.mCall);
    return <Button title="On / Off" onPress={() => this.Start('AKEKOUKOU', true, false)} />
  }
}

export default Communication;
