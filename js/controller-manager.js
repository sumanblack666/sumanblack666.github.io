'use strict';

import { sleep } from './utils.js';

class ControllerManager {
  constructor(uiDependencies = {}) {
    this.currentController = null;
    this.handleNvStatusUpdate = uiDependencies.handleNvStatusUpdate;
    this.inputHandler = null;

    this.button_states = {
      sticks: {
        left: { x: 0, y: 0 },
        right: { x: 0, y: 0 }
      }
    };

    this.touchPoints = [];

    this.batteryStatus = {
      bat_txt: "",
      changed: false,
      bat_capacity: 0,
      cable_connected: false,
      is_charging: false,
      is_error: false
    };
    this._lastBatteryText = "";
  }

  setControllerInstance(instance) {
    this.currentController = instance;
  }

  getDevice() {
    return this.currentController?.getDevice() || null;
  }

  getInputConfig() {
    return this.currentController.getInputConfig();
  }

  async getDeviceInfo() {
    if (!this.currentController) return null;
    return await this.currentController.getInfo();
  }

  setInputReportHandler(handler) {
    if (!this.currentController) return;
    this.currentController.device.oninputreport = handler;
  }

  async queryNvStatus() {
    const nv = await this.currentController.queryNvStatus();
    this.handleNvStatusUpdate(nv);
    return nv;
  }

  getModel() {
    if (!this.currentController) return null;
    return this.currentController.getModel();
  }

  isConnected() {
    return this.currentController !== null;
  }

  setInputHandler(callback) {
    this.inputHandler = callback;
  }

  async disconnect() {
    if (this.currentController) {
      await this.currentController.close();
      this.currentController = null;
    }
  }

  _sticksChanged(current, newValues) {
    return current.left.x !== newValues.left.x || current.left.y !== newValues.left.y ||
    current.right.x !== newValues.right.x || current.right.y !== newValues.right.y;
  }

  _recordButtonStates(data, BUTTON_MAP, dpad_byte, l2_analog_byte, r2_analog_byte) {
    const changes = {};

    const [new_lx, new_ly, new_rx, new_ry] = [0, 1, 2, 3]
      .map(i => data.getUint8(i))
      .map(v => Math.round((v - 127.5) / 128 * 100) / 100);

    const newSticks = {
      left: { x: new_lx, y: new_ly },
      right: { x: new_rx, y: new_ry }
    };

    if (this._sticksChanged(this.button_states.sticks, newSticks)) {
      this.button_states.sticks = newSticks;
      changes.sticks = newSticks;
    }

    [
      ['l2', l2_analog_byte],
      ['r2', r2_analog_byte]
    ].forEach(([name, byte]) => {
      const val = data.getUint8(byte);
      const key = name + '_analog';
      if (val !== this.button_states[key]) {
        this.button_states[key] = val;
        changes[key] = val;
      }
    });

    const hat = data.getUint8(dpad_byte) & 0x0F;
    const dpad_map = {
      up:    (hat === 0 || hat === 1 || hat === 7),
      right: (hat === 1 || hat === 2 || hat === 3),
      down:  (hat === 3 || hat === 4 || hat === 5),
      left:  (hat === 5 || hat === 6 || hat === 7)
    };
    for (const dir of ['up', 'right', 'down', 'left']) {
      const pressed = dpad_map[dir];
      if (this.button_states[dir] !== pressed) {
        this.button_states[dir] = pressed;
        changes[dir] = pressed;
      }
    }

    for (const btn of BUTTON_MAP) {
      if (['up', 'right', 'down', 'left'].includes(btn.name)) continue;
      const pressed = (data.getUint8(btn.byte) & btn.mask) !== 0;
      if (this.button_states[btn.name] !== pressed) {
        this.button_states[btn.name] = pressed;
        changes[btn.name] = pressed;
      }
    }

    return changes;
  }

  processControllerInput(inputData) {
    const { data } = inputData;

    const inputConfig = this.currentController.getInputConfig();
    const { buttonMap, dpadByte, l2AnalogByte, r2AnalogByte } = inputConfig;
    const { touchpadOffset } = inputConfig;

    const changes = this._recordButtonStates(data, buttonMap, dpadByte, l2AnalogByte, r2AnalogByte);

    if (touchpadOffset) {
      this.touchPoints = this._parseTouchPoints(data, touchpadOffset);
    }

    this.batteryStatus = this._parseBatteryStatus(data);

    const result = {
      changes,
      inputConfig: { buttonMap },
      touchPoints: this.touchPoints,
      batteryStatus: this.batteryStatus,
    };

    this.inputHandler(result);
  }

  _parseTouchPoints(data, offset) {
    const points = [];
    for (let i = 0; i < 2; i++) {
      const base = offset + i * 4;
      const b0 = data.getUint8(base);
      const active = (b0 & 0x80) === 0;
      const id = b0 & 0x7F;
      const b1 = data.getUint8(base + 1);
      const b2 = data.getUint8(base + 2);
      const b3 = data.getUint8(base + 3);
      const x = ((b2 & 0x0F) << 8) | b1;
      const y = (b3 << 4) | (b2 >> 4);
      points.push({ active, id, x, y });
    }
    return points;
  }

  _parseBatteryStatus(data) {
    const batteryInfo = this.currentController.parseBatteryStatus(data);
    const bat_txt = this._batteryPercentToText(batteryInfo);

    const changed = bat_txt !== this._lastBatteryText;
    this._lastBatteryText = bat_txt;

    return { bat_txt, changed, ...batteryInfo };
  }

  _batteryPercentToText({bat_capacity, is_charging, is_error}) {
    if (is_error) {
      return 'error';
    }
    return `${bat_capacity}% ${is_charging ? 'charging' : ''}`;
  }

  getInputHandler() {
    return this.processControllerInput.bind(this);
  }
}

export function initControllerManager(dependencies = {}) {
  return new ControllerManager(dependencies);
}