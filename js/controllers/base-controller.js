'use strict';

class BaseController {
  constructor(device) {
    this.device = device;
    this.model = "undefined";
  }

  getModel() {
    return this.model;
  }

  getDevice() {
    return this.device;
  }

  getInputConfig() {
    throw new Error('getInputConfig() must be implemented by subclass');
  }

  setInputReportHandler(handler) {
    this.device.oninputreport = handler;
  }

  alloc_req(id, data = []) {
    const fr = this.device.collections[0].featureReports;
    const [report] = fr.find(e => e.reportId === id)?.items || [];
    const maxLen = report?.reportCount || data.length;

    const len = Math.min(data.length, maxLen);
    const out = new Uint8Array(maxLen);
    out.set(data.slice(0, len));
    return out;
  }

  async sendFeatureReport(reportId, data) {
    if (Array.isArray(data)) {
      data = this.alloc_req(reportId, data);
    }

    try {
      return await this.device.sendFeatureReport(reportId, data);
    } catch (error) {
      throw new Error(error.stack);
    }
  }

  async receiveFeatureReport(reportId) {
    return await this.device.receiveFeatureReport(reportId);
  }

  async close() {
    if (this.device?.opened) {
      await this.device.close();
    }
  }

  async getInfo() {
    throw new Error('getInfo() must be implemented by subclass');
  }

  parseBatteryStatus(data) {
    throw new Error('parseBatteryStatus() must be implemented by subclass');
  }
}

export default BaseController;