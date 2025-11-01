'use strict';

import BaseController from './base-controller.js';
import {
  sleep,
  buf2hex,
  dec2hex,
  dec2hex32,
  format_mac_from_view
} from '../utils.js';

const DS4_BUTTON_MAP = [
  { name: 'up', byte: 4, mask: 0x0 },
  { name: 'right', byte: 4, mask: 0x1 },
  { name: 'down', byte: 4, mask: 0x2 },
  { name: 'left', byte: 4, mask: 0x3 },
  { name: 'square', byte: 4, mask: 0x10, svg: 'Square' },
  { name: 'cross', byte: 4, mask: 0x20, svg: 'Cross' },
  { name: 'circle', byte: 4, mask: 0x40, svg: 'Circle' },
  { name: 'triangle', byte: 4, mask: 0x80, svg: 'Triangle' },
  { name: 'l1', byte: 5, mask: 0x01, svg: 'L1' },
  { name: 'l2', byte: 5, mask: 0x04, svg: 'L2' },
  { name: 'r1', byte: 5, mask: 0x02, svg: 'R1' },
  { name: 'r2', byte: 5, mask: 0x08, svg: 'R2' },
  { name: 'create', byte: 5, mask: 0x10, svg: 'Create' },
  { name: 'options', byte: 5, mask: 0x20, svg: 'Options' },
  { name: 'l3', byte: 5, mask: 0x40, svg: 'L3' },
  { name: 'r3', byte: 5, mask: 0x80, svg: 'R3' },
  { name: 'ps', byte: 6, mask: 0x01, svg: 'PS' },
  { name: 'touchpad', byte: 6, mask: 0x02, svg: 'Trackpad' },
];

const DS4_INPUT_CONFIG = {
  buttonMap: DS4_BUTTON_MAP,
  dpadByte: 4,
  l2AnalogByte: 7,
  r2AnalogByte: 8,
  touchpadOffset: 34,
};

class DS4Controller extends BaseController {
  constructor(device) {
    super(device);
    this.model = "DS4";
  }

  getInputConfig() {
    return DS4_INPUT_CONFIG;
  }

  async getInfo() {
    try {
      const view = await this.receiveFeatureReport(0xa3);
      const is_clone = view.buffer.byteLength < 49;

      const infoItems = [];
      const nv = await this.queryNvStatus();
      const disable_bits = is_clone ? 1 : 0;

      return { ok: true, infoItems, nv, disable_bits, rare: false };
    } catch(error) {
      return { ok: false, error, disable_bits: 1 };
    }
  }

  async queryNvStatus() {
    try {
      await this.sendFeatureReport(0x08, [0xff,0, 12]);
      const data = await this.receiveFeatureReport(0x11);
      const ret = data.getUint8(1, false);
      const res = { device: 'ds4', code: ret }
      switch(ret) {
        case 1:
          return { ...res, status: 'locked', locked: true, mode: 'temporary' };
        case 0:
          return { ...res, status: 'unlocked', locked: false, mode: 'permanent' };
        default:
          return { ...res, status: 'unknown', locked: null };
      }
    } catch (error) {
      return { device: 'ds4', status: 'error', locked: null, code: 2, error };
    }
  }

  parseBatteryStatus(data) {
    const bat = data.getUint8(29);
    const bat_data = bat & 0x0f;
    const bat_status = (bat >> 4) & 1;
    const cable_connected = bat_status === 1;

    let bat_capacity = 0;
    let is_charging = false;
    let is_error = false;

    if (cable_connected) {
      if (bat_data < 10) {
        bat_capacity = Math.min(bat_data * 10 + 5, 100);
        is_charging = true;
      } else if (bat_data === 10) {
        bat_capacity = 100;
        is_charging = true;
      } else if (bat_data === 11) {
        bat_capacity = 100;
      } else {
        bat_capacity = 0;
        is_error = true;
      }
    } else {
      bat_capacity = bat_data < 10 ? bat_data * 10 + 5 : 100;
    }

    return { bat_capacity, cable_connected, is_charging, is_error };
  }
}

export default DS4Controller;