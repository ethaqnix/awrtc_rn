import { SLog } from '../network/index';
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

export class ReactNativeDeviceInfo {
  public deviceId: string = null;
  public defaultLabel: string = null;
  public label: string = null;
  public isLabelGuessed: boolean = true;
}

export interface ReactNativeDeviceApiOnChanged {
  (): void;
}

export class ReactNativeDeviceApi {
  private static sLastUpdate = 0;
  public static get LastUpdate(): number {
    return ReactNativeDeviceApi.sLastUpdate;
  }
  public static get HasInfo() {
    return ReactNativeDeviceApi.sLastUpdate > 0;
  }

  private static sIsPending = false;
  public static get IsPending() {
    return ReactNativeDeviceApi.sIsPending;
  }

  private static sLastError: string = null;
  private static get LastError() {
    return this.sLastError;
  }


  private static sDeviceInfo: { [id: string]: ReactNativeDeviceInfo; } = {};
  private static sVideoDeviceCounter = 1;
  private static sAccessStream: MediaStream = null;


  private static sUpdateEvents: Array<ReactNativeDeviceApiOnChanged> = [];
  public static AddOnChangedHandler(evt: ReactNativeDeviceApiOnChanged) {
    ReactNativeDeviceApi.sUpdateEvents.push(evt);
  }
  public static RemOnChangedHandler(evt: ReactNativeDeviceApiOnChanged) {
    let index = ReactNativeDeviceApi.sUpdateEvents.indexOf(evt);
    if (index >= 0)
      ReactNativeDeviceApi.sUpdateEvents.splice(index, 1);
  }

  private static TriggerChangedEvent() {
    for (let v of ReactNativeDeviceApi.sUpdateEvents) {
      try {
        v();
      } catch (e) {
        SLog.LE("Error in DeviceApi user event handler: " + e);
        console.exception(e);
      }
    }
  }

  private static InternalOnEnum = (devices: MediaDeviceInfo[]) => {
    ReactNativeDeviceApi.sIsPending = false;
    ReactNativeDeviceApi.sLastUpdate = new Date().getTime();

    let newDeviceInfo: { [id: string]: ReactNativeDeviceInfo; } = {};
    for (let info of devices) {
      if (info.kind != "videoinput")
        continue;
      let newInfo = new ReactNativeDeviceInfo();
      newInfo.deviceId = info.deviceId;

      let knownInfo: ReactNativeDeviceInfo = null;
      if (newInfo.deviceId in ReactNativeDeviceApi.Devices) {
        //known device. reuse the default label
        knownInfo = ReactNativeDeviceApi.Devices[newInfo.deviceId];
      }


      //check if we gave this device a default label already
      //this is used to identify it via a user readable name in case
      //we update multiple times with proper labels / default labels
      if (knownInfo != null) {
        newInfo.defaultLabel = knownInfo.defaultLabel;
      } else {
        newInfo.defaultLabel = info.kind + " " + ReactNativeDeviceApi.sVideoDeviceCounter;;
        ReactNativeDeviceApi.sVideoDeviceCounter++;
      }

      //check if we know a proper label or got one this update
      if (knownInfo != null && knownInfo.isLabelGuessed == false) {
        //already have one
        newInfo.label = knownInfo.label;
        newInfo.isLabelGuessed = false;
      } else if (info.label) {
        //got a new one
        newInfo.label = info.label;
        newInfo.isLabelGuessed = false;
      } else {
        //no known label -> just use the default one
        newInfo.label = newInfo.defaultLabel;
        newInfo.isLabelGuessed = true;
      }

      newDeviceInfo[newInfo.deviceId] = newInfo;
    }

    ReactNativeDeviceApi.sDeviceInfo = newDeviceInfo;

    if (ReactNativeDeviceApi.sAccessStream) {
      var tracks = ReactNativeDeviceApi.sAccessStream.getTracks();
      for (var i = 0; i < tracks.length; i++) {
        tracks[i].stop();
      }
      ReactNativeDeviceApi.sAccessStream = null;
    }
    ReactNativeDeviceApi.TriggerChangedEvent();
  }

  public static get Devices() {
    return ReactNativeDeviceApi.sDeviceInfo;
  }
  public static Reset() {
    ReactNativeDeviceApi.sUpdateEvents = [];
    ReactNativeDeviceApi.sLastUpdate = 0;
    ReactNativeDeviceApi.sDeviceInfo = {};
    ReactNativeDeviceApi.sVideoDeviceCounter = 1;
    ReactNativeDeviceApi.sAccessStream = null;
    ReactNativeDeviceApi.sLastError = null;
    ReactNativeDeviceApi.sIsPending = false;
  }

  private static InternalOnErrorCatch = (err: DOMError) => {
    let txt: string = err.toString();
    ReactNativeDeviceApi.InternalOnErrorString(txt);
  }
  private static InternalOnErrorString = (err: string) => {
    ReactNativeDeviceApi.sIsPending = false;
    ReactNativeDeviceApi.sLastError = err;
    SLog.LE(err);
    ReactNativeDeviceApi.TriggerChangedEvent();
  }

  private static InternalOnStream = (stream: MediaStream) => {
    ReactNativeDeviceApi.sAccessStream = stream;
    ReactNativeDeviceApi.Update();
  }


  /**Updates the device list based on the current
   * access. Gives the devices numbers if the name isn't known.
   */
  public static Update(): void {
    ReactNativeDeviceApi.sLastError = null;
    if (ReactNativeDeviceApi.IsApiAvailable()) {
      ReactNativeDeviceApi.sIsPending = true;
      navigator.mediaDevices.enumerateDevices()
        .then(ReactNativeDeviceApi.InternalOnEnum)
        .catch(ReactNativeDeviceApi.InternalOnErrorCatch);
    } else {
      ReactNativeDeviceApi.InternalOnErrorString("Can't access mediaDevices or enumerateDevices");
    }
  }
  /**Checks if the API is available in the ReactNative.
   * false - ReactNative doesn't support this API
   * true - ReactNative supports the API (might still refuse to give
   * us access later on)
   */
  public static IsApiAvailable(): boolean {
    if (navigator && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)
      return true;
    return false;
  }
  /**Asks the user for access first to get the full
   * device names.
   */
  public static RequestUpdate(): void {
    ReactNativeDeviceApi.sLastError = null;
    if (ReactNativeDeviceApi.IsApiAvailable()) {
      ReactNativeDeviceApi.sIsPending = true;
      let constraints = { video: true };
      navigator.mediaDevices.getUserMedia(constraints)
        .then(ReactNativeDeviceApi.InternalOnStream)
        .catch(ReactNativeDeviceApi.InternalOnErrorCatch);
    } else {
      ReactNativeDeviceApi.InternalOnErrorString("Can't access mediaDevices or enumerateDevices");
    }
  }


  public static GetDeviceId(label: string): string {

    let devs = ReactNativeDeviceApi.Devices;
    for (var key in devs) {
      let dev = devs[key];
      if (dev.label == label || dev.defaultLabel == label || dev.deviceId == label) {

        return dev.deviceId;
      }
    }
    return null;
  }
}