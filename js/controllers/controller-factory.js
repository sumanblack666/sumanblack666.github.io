'use strict';

import DS4Controller from './ds4-controller.js';
import DS5Controller from './ds5-controller.js';
import DS5EdgeController from './ds5-edge-controller.js';
import { dec2hex } from '../utils.js';

class ControllerFactory {
  static getSupportedModels() {
    const ds4v1 = { vendorId: 0x054c, productId: 0x05c4 };
    const ds4v2 = { vendorId: 0x054c, productId: 0x09cc };
    const ds5 = { vendorId: 0x054c, productId: 0x0ce6 };
    const ds5edge = { vendorId: 0x054c, productId: 0x0df2 };
    return [ds4v1, ds4v2, ds5, ds5edge];
  }

  static createControllerInstance(device) {
    switch (device.productId) {
      case 0x05c4:
      case 0x09cc:
        return new DS4Controller(device);

      case 0x0ce6:
        return new DS5Controller(device);

      case 0x0df2:
        return new DS5EdgeController(device);

      default:
        throw new Error(`Unsupported device: ${dec2hex(device.vendorId)}:${dec2hex(device.productId)}`);
    }
  }

  static getDeviceName(productId) {
    switch (productId) {
      case 0x05c4:
        return "Sony DualShock 4 V1";
      case 0x09cc:
        return "Sony DualShock 4 V2";
      case 0x0ce6:
        return "Sony DualSense";
      case 0x0df2:
        return "Sony DualSense Edge";
      default:
        return "Unknown Device";
    }
  }
}

export default ControllerFactory;