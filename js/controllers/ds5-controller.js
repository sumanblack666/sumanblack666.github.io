'use strict';

import BaseController from './base-controller.js';
import {
  sleep,
  buf2hex,
  dec2hex,
  dec2hex32,
  dec2hex8,
  format_mac_from_view,
  reverse_str,
} from '../utils.js';

const DS5_BUTTON_MAP = [
  { name: 'up', byte: 7, mask: 0x0 },
  { name: 'right', byte: 7, mask: 0x1 },
  { name: 'down', byte: 7, mask: 0x2 },
  { name: 'left', byte: 7, mask: 0x3 },
  { name: 'square', byte: 7, mask: 0x10, svg: 'Square' },
  { name: 'cross', byte: 7, mask: 0x20, svg: 'Cross' },
  { name: 'circle', byte: 7, mask: 0x40, svg: 'Circle' },
  { name: 'triangle', byte: 7, mask: 0x80, svg: 'Triangle' },
  { name: 'l1', byte: 8, mask: 0x01, svg: 'L1' },
  { name: 'l2', byte: 4, mask: 0xff },
  { name: 'r1', byte: 8, mask: 0x02, svg: 'R1' },
  { name: 'r2', byte: 5, mask: 0xff },
  { name: 'create', byte: 8, mask: 0x10, svg: 'Create' },
  { name: 'options', byte: 8, mask: 0x20, svg: 'Options' },
  { name: 'l3', byte: 8, mask: 0x40, svg: 'L3' },
  { name: 'r3', byte: 8, mask: 0x80, svg: 'R3' },
  { name: 'ps', byte: 9, mask: 0x01, svg: 'PS' },
  { name: 'touchpad', byte: 9, mask: 0x02, svg: 'Trackpad' },
  { name: 'mute', byte: 9, mask: 0x04, svg: 'Mute' },
];

const DS5_INPUT_CONFIG = {
  buttonMap: DS5_BUTTON_MAP,
  dpadByte: 7,
  l2AnalogByte: 4,
  r2AnalogByte: 5,
  touchpadOffset: 32,
};

class DS5Controller extends BaseController {
  constructor(device) {
    super(device);
    this.model = "DS5";
  }

  getInputConfig() {
    return DS5_INPUT_CONFIG;
  }

  async getInfo() {
    return this._getInfo(false);
  }

  async _getInfo(is_edge) {
    try {
      const view = await this.receiveFeatureReport(0x20);
      const cmd = view.getUint8(0, true);
      if(cmd != 0x20 || view.buffer.byteLength != 64)
        return { ok: false, error: new Error("Invalid response for ds5_info") };

      const infoItems = [];
      const nv = await this.queryNvStatus();
      const pending_reboot = (nv?.status === 'pending_reboot');

      return { ok: true, infoItems, nv, disable_bits: 0, pending_reboot };
    } catch(error) {
      return { ok: false, error, disable_bits: 1 };
    }
  }

  async getSystemInfo(base, num, length, decode = true) {
    await this.sendFeatureReport(128, [base,num])
    const pcba_id = await this.receiveFeatureReport(129);
    if(pcba_id.getUint8(1) != base || pcba_id.getUint8(2) != num || pcba_id.getUint8(3) != 2) {
      return "error";
    }
    if(decode)
      return new TextDecoder().decode(pcba_id.buffer.slice(4, 4+length));

    return buf2hex(pcba_id.buffer.slice(4, 4+length));
  }

  async queryNvStatus() {
    try {
      await this.sendFeatureReport(0x80, [3,3]);
      const data = await this.receiveFeatureReport(0x81);
      const ret = data.getUint32(1, false);
      if (ret === 0x15010100) {
        return { device: 'ds5', status: 'pending_reboot', locked: null, code: 4, raw: ret };
      }
      if (ret === 0x03030201) {
        return { device: 'ds5', status: 'locked', locked: true, mode: 'temporary', code: 1, raw: ret };
      }
      if (ret === 0x03030200) {
        return { device: 'ds5', status: 'unlocked', locked: false, mode: 'permanent', code: 0, raw: ret };
      }
      if (ret === 1 || ret === 2) {
        return { device: 'ds5', status: 'unknown', locked: null, code: 2, raw: ret };
      }
      return { device: 'ds5', status: 'unknown', locked: null, code: ret, raw: ret };
    } catch (error) {
      return { device: 'ds5', status: 'error', locked: null, code: 2, error };
    }
  }

  parseBatteryStatus(data) {
    const bat = data.getUint8(52);
    const bat_charge = bat & 0x0f;
    const bat_status = bat >> 4;

    let bat_capacity = 0;
    let cable_connected = false;
    let is_charging = false;
    let is_error = false;

    switch (bat_status) {
      case 0:
        bat_capacity = Math.min(bat_charge * 10 + 5, 100);
        break;
      case 1:
        bat_capacity = Math.min(bat_charge * 10 + 5, 100);
        is_charging = true;
        cable_connected = true;
        break;
      case 2:
        bat_capacity = 100;
        cable_connected = true;
        break;
      case 15:
        bat_capacity = 0;
        is_charging = true;
        cable_connected = true;
        break;
      default:
        is_error = true;
        break;
    }

    return { bat_capacity, cable_connected, is_charging, is_error };
  }
}

export default DS5Controller;