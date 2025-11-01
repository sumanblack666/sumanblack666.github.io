'use strict';

import DS5Controller from './ds5-controller.js';
import { sleep, dec2hex32 } from '../utils.js';

class DS5EdgeController extends DS5Controller {
  constructor(device) {
    super(device);
    this.model = "DS5_Edge";
    this.finetuneMaxValue = 4095;
  }

  async getInfo() {
    const result = await this._getInfo(true);
    return result;
  }
}

export default DS5EdgeController;