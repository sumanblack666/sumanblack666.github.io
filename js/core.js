'use strict';

import { sleep, float_to_str, dec2hex, lerp_color } from './utils.js';
import { initControllerManager } from './controller-manager.js';
import ControllerFactory from './controllers/controller-factory.js';
import { draw_stick_position, CIRCULARITY_DATA_SIZE } from './stick-renderer.js';

// Application State - manages app-wide state and UI
const app = {
  // Button disable state management
  disable_btn: 0,
  last_disable_btn: 0,

  shownRangeCalibrationWarning: false,
};

const ll_data = new Array(CIRCULARITY_DATA_SIZE);
const rr_data = new Array(CIRCULARITY_DATA_SIZE);

let controller = null;

function gboot() {
  async function initializeApp() {
    window.addEventListener("error", (event) => {
      console.error(event.error?.stack || event.message);
      alert(event.error?.message || event.message);
    });

    window.addEventListener("unhandledrejection", async (event) => {
      console.error("Unhandled rejection:", event.reason?.stack || event.reason);
      let errorMessage = "An unexpected error occurred";
      if (event.reason) {
        if (event.reason.message) {
          errorMessage = `Error: ${event.reason.message}`;
        } else if (typeof event.reason === 'string') {
          errorMessage = `Error: ${event.reason}`;
        }
      }
      alert(errorMessage);
      event.preventDefault();
    });

    $("input[name='displayMode']").on('change', on_stick_mode_change);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }

  if (!("hid" in navigator)) {
    $("#offlinebar").hide();
    $("#onlinebar").hide();
    $("#missinghid").show();
    return;
  }

  $("#offlinebar").show();
  navigator.hid.addEventListener("disconnect", handleDisconnectedDevice);
}

async function connect() {
  controller = initControllerManager({ handleNvStatusUpdate });
  controller.setInputHandler(handleControllerInput);

  reset_circularity_mode();
  await sleep(200);

  try {
    $("#btnconnect").prop("disabled", true);
    $("#connectspinner").show();
    await sleep(100);

    const supportedModels = ControllerFactory.getSupportedModels();
    const requestParams = { filters: supportedModels };
    let devices = await navigator.hid.getDevices();
    if (devices.length == 0) {
      devices = await navigator.hid.requestDevice(requestParams);
    }
    if (devices.length == 0) {
      $("#btnconnect").prop("disabled", false);
      $("#connectspinner").hide();
      await disconnect();
      return;
    }

    if (devices.length > 1) {
        alert("Please connect only one controller at time.");
        $("#btnconnect").prop("disabled", false);
        $("#connectspinner").hide();
        await disconnect();
        return;
    }

    const [device] = devices;
    if(device.opened) {
      console.log("Device already opened, closing it before re-opening.");
      await device.close();
      await sleep(500);
    }
    await device.open();

    device.oninputreport = continue_connection;
  } catch(error) {
    $("#btnconnect").prop("disabled", false);
    $("#connectspinner").hide();
    await disconnect();
    throw error;
  }
}

async function continue_connection({data, device}) {
  try {
    if (!controller || controller.isConnected()) {
      device.oninputreport = null;
      return;
    }

    const reportLen = data.byteLength;
    if(reportLen != 63) {
      alert("The device is connected via Bluetooth. Disconnect and reconnect using a USB cable instead.");
      await disconnect();
      return;
    }

    let controllerInstance = null;
    let info = null;

    try {
      controllerInstance = ControllerFactory.createControllerInstance(device);
      controller.setControllerInstance(controllerInstance);

      info = await controllerInstance.getInfo();

      if (controllerInstance.initializeCurrentOutputState) {
        await controllerInstance.initializeCurrentOutputState();
      }
    } catch (error) {
      const contextMessage = device
        ? `Connected invalid device: ${dec2hex(device.vendorId)}:${dec2hex(device.productId)}`
        : "Failed to connect to device";
        throw new Error(contextMessage, { cause: error });
    }

    if(!info?.ok) {
      if(info) console.error(JSON.stringify(info, null, 2));
      throw new Error(`Connected invalid device: Error  1`, { cause: info?.error });
    }

    console.log("Setting input report handler.");
    device.oninputreport = controller.getInputHandler();

    const deviceName = ControllerFactory.getDeviceName(device.productId);
    $("#devname").text(deviceName + " (" + dec2hex(device.vendorId) + ":" + dec2hex(device.productId) + ")");

    $("#offlinebar").hide();
    $("#onlinebar").show();
    $("#mainmenu").show();

    const model = controllerInstance.getModel();

    await init_svg_controller(model);

  } catch(err) {
    await disconnect();
    throw err;
  } finally {
    $("#btnconnect").prop("disabled", false);
    $("#connectspinner").hide();
  }
}

async function disconnect() {
  if(!controller?.isConnected()) {
    controller = null;
    return;
  }

  await controller.disconnect();
  controller = null;
  $("#offlinebar").show();
  $("#onlinebar").hide();
  $("#mainmenu").hide();
}

function disconnectSync() {
  disconnect().catch(error => {
    throw new Error("Failed to disconnect", { cause: error });
  });
}

async function handleDisconnectedDevice(e) {
  console.log("Disconnected: " + e.device.productName)
  await disconnect();
}

async function init_svg_controller(model) {
  const svgContainer = document.getElementById('controller-svg-placeholder');

  let svgFileName;
  if (model === 'DS4') {
    svgFileName = 'dualshock-controller.svg';
  } else if (model === 'DS5' || model === 'DS5_Edge') {
    svgFileName = 'dualsense-controller.svg';
  } else {
    throw new Error(`Unknown controller model: ${model}`);
  }

  let svgContent;

  const response = await fetch(`assets/${svgFileName}`);
  if (!response.ok) {
    throw new Error(`Failed to load controller SVG: ${svgFileName}`);
  }
  svgContent = await response.text();

  svgContainer.innerHTML = svgContent;

  const lightBlue = '#7ecbff';
  const midBlue = '#3399cc';
  const dualshock = document.getElementById('Controller');
  set_svg_group_color(dualshock, lightBlue);

  ['Button_outlines', 'Button_outlines_behind', 'L3_outline', 'R3_outline', 'Trackpad_outline'].forEach(id => {
    const group = document.getElementById(id);
    set_svg_group_color(group, midBlue);
  });

  ['Controller_infills', 'Button_infills', 'L3_infill', 'R3_infill', 'Trackpad_infill'].forEach(id => {
    const group = document.getElementById(id);
    set_svg_group_color(group, 'white');
  });
}

function collectCircularityData(stickStates, leftData, rightData) {
  const { left, right  } = stickStates || {};
  const MAX_N = CIRCULARITY_DATA_SIZE;

  for(const [stick, data] of [[left, leftData], [right, rightData]]) {
    if (!stick) return;

    const { x, y } = stick;
    const distance = Math.sqrt(x * x + y * y);
    const angleIndex = (parseInt(Math.round(Math.atan2(y, x) * MAX_N / 2.0 / Math.PI)) + MAX_N) % MAX_N;
    const oldValue = data[angleIndex] ?? 0;
    data[angleIndex] = Math.max(oldValue, distance);
  }
}

function clear_circularity() {
  ll_data.fill(0);
  rr_data.fill(0);
}

function reset_circularity_mode() {
  clear_circularity();
  $("#normalMode").prop('checked', true);
  refresh_stick_pos();
}

function refresh_stick_pos() {
  if(!controller) return;

  const c = document.getElementById("stickCanvas");
  const ctx = c.getContext("2d");
  const sz = 60;
  const hb = 20 + sz;
  const yb = 15 + sz;
  const w = c.width;
  ctx.clearRect(0, 0, c.width, c.height);

  const { left: { x: plx, y: ply }, right: { x: prx, y: pry } } = controller.button_states.sticks;

  const enable_zoom_center = center_zoom_checked();
  const enable_circ_test = circ_checked();

  draw_stick_position(ctx, hb, yb, sz, plx, ply, {
    circularity_data: enable_circ_test ? ll_data : null,
    enable_zoom_center,
  });

  draw_stick_position(ctx, w-hb, yb, sz, prx, pry, {
    circularity_data: enable_circ_test ? rr_data : null,
    enable_zoom_center,
  });

  const precision = enable_zoom_center ? 3 : 2;
  $("#lx-lbl").text(float_to_str(plx, precision));
  $("#ly-lbl").text(float_to_str(ply, precision));
  $("#rx-lbl").text(float_to_str(prx, precision));
  $("#ry-lbl").text(float_to_str(pry, precision));

  try {
    switch(controller.getModel()) {
      case "DS4":
        const ds4_max_stick_offset = 25;
        const ds4_l3_cx = 295.63, ds4_l3_cy = 461.03;
        const ds4_r3_cx = 662.06, ds4_r3_cy = 419.78;

        const ds4_l3_x = ds4_l3_cx + plx * ds4_max_stick_offset;
        const ds4_l3_y = ds4_l3_cy + ply * ds4_max_stick_offset;
        const ds4_l3_group = document.querySelector('g#L3');
        ds4_l3_group?.setAttribute('transform', `translate(${ds4_l3_x - ds4_l3_cx},${ds4_l3_y - ds4_l3_cy})`);

        const ds4_r3_x = ds4_r3_cx + prx * ds4_max_stick_offset;
        const ds4_r3_y = ds4_r3_cy + pry * ds4_max_stick_offset;
        const ds4_r3_group = document.querySelector('g#R3');
        ds4_r3_group?.setAttribute('transform', `translate(${ds4_r3_x - ds4_r3_cx},${ds4_r3_y - ds4_r3_cy})`);
        break;
      case "DS5":
      case "DS5_Edge":
        const ds5_max_stick_offset = 25;
        const ds5_l3_cx = 295.63, ds5_l3_cy = 461.03;
        const ds5_r3_cx = 662.06, ds5_r3_cy = 419.78;

        const ds5_l3_x = ds5_l3_cx + plx * ds5_max_stick_offset;
        const ds5_l3_y = ds5_l3_cy + ply * ds5_max_stick_offset;
        const ds5_l3_group = document.querySelector('g#L3');
        ds5_l3_group?.setAttribute('transform', `translate(${ds5_l3_x - ds5_l3_cx},${ds5_l3_y - ds5_l3_cy}) scale(0.70)`);

        const ds5_r3_x = ds5_r3_cx + prx * ds5_max_stick_offset;
        const ds5_r3_y = ds5_r3_cy + pry * ds5_max_stick_offset;
        const ds5_r3_group = document.querySelector('g#R3');
        ds5_r3_group?.setAttribute('transform', `translate(${ds5_r3_x - ds5_r3_cx},${ds5_r3_y - ds5_r3_cy}) scale(0.70)`);
        break;
      default:
        return;
    }
  } catch (e) {
  }
}

const circ_checked = () => $("#checkCircularityMode").is(':checked');
const center_zoom_checked = () => $("#centerZoomMode").is(':checked');

function resetStickDiagrams() {
  clear_circularity();
  refresh_stick_pos();
}

const on_stick_mode_change = () => resetStickDiagrams();

const throttled_refresh_sticks = (() => {
  let delay = null;
  return function(changes) {
    if (!changes.sticks) return;
    if (delay) return;

    refresh_stick_pos();
    delay = setTimeout(() => {
      delay = null;
      refresh_stick_pos();
    }, 20);
  };
})();

const update_stick_graphics = (changes) => throttled_refresh_sticks(changes);

function update_battery_status({ bat_txt, changed }) {
  if(changed) {
    $("#d-bat").html(bat_txt);
  }
}

function update_ds_button_svg(changes, BUTTON_MAP) {
  if (!changes || Object.keys(changes).length === 0) return;

  const pressedColor = '#1a237e';

  for (const trigger of ['l2', 'r2']) {
    const key = trigger + '_analog';
    if (changes.hasOwnProperty(key)) {
      const val = changes[key];
      const t = val / 255;
      const color = lerp_color('#ffffff', pressedColor, t);
      const svg = trigger.toUpperCase() + '_infill';
      const infill = document.getElementById(svg);
      set_svg_group_color(infill, color);

      const percentage = Math.round((val / 255) * 100);
      const percentageText = document.getElementById(trigger.toUpperCase() + '_percentage');
      if (percentageText) {
        percentageText.textContent = `${percentage} %`;
        percentageText.setAttribute('opacity', percentage > 0 ? '1' : '0');
        percentageText.setAttribute('fill', percentage < 35 ? pressedColor : 'white');
      }
    }
  }

  for (const dir of ['up', 'right', 'down', 'left']) {
    if (changes.hasOwnProperty(dir)) {
      const pressed = changes[dir];
      const group = document.getElementById(dir.charAt(0).toUpperCase() + dir.slice(1) + '_infill');
      set_svg_group_color(group, pressed ? pressedColor : 'white');
    }
  }

  for (const btn of BUTTON_MAP) {
    if (['up', 'right', 'down', 'left'].includes(btn.name)) continue;
    if (changes.hasOwnProperty(btn.name) && btn.svg) {
      const pressed = changes[btn.name];
      const group = document.getElementById(btn.svg + '_infill');
      set_svg_group_color(group, pressed ? pressedColor : 'white');
    }
  }
}

function set_svg_group_color(group, color) {
  if (group) {
    const elements = group.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon');
    elements.forEach(el => {
      if (!el.style.transition) {
        el.style.transition = 'fill 0.10s, stroke 0.10s';
      }
      el.setAttribute('fill', color);
      el.setAttribute('stroke', color);
    });
  }
}

let hasActiveTouchPoints = false;
let trackpadBbox = undefined;

function update_touchpad_circles(points) {
  const hasActivePointsNow = points.some(pt => pt.active);
  if(!hasActivePointsNow && !hasActiveTouchPoints) return;

  const svg = document.getElementById('controller-svg');
  const trackpad = svg?.querySelector('g#Trackpad_infill');
  if (!trackpad) return;

  trackpad.querySelectorAll('circle.ds-touch').forEach(c => c.remove());
  hasActiveTouchPoints = hasActivePointsNow;
  trackpadBbox = trackpadBbox ?? trackpad.querySelector('path')?.getBBox();

  points.forEach((pt, idx) => {
    if (!pt.active) return;
    const RAW_W = 1920, RAW_H = 943;
    const pointRadius = trackpadBbox.width * 0.05;
    const cx = trackpadBbox.x + pointRadius + (pt.x / RAW_W) * (trackpadBbox.width - pointRadius*2);
    const cy = trackpadBbox.y + pointRadius + (pt.y / RAW_H) * (trackpadBbox.height - pointRadius*2);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'ds-touch');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', pointRadius);
    circle.setAttribute('fill', idx === 0 ? '#2196f3' : '#e91e63');
    circle.setAttribute('fill-opacity', '0.5');
    circle.setAttribute('stroke', '#3399cc');
    circle.setAttribute('stroke-width', '4');
    trackpad.appendChild(circle);
  });
}

function handleControllerInput({ changes, inputConfig, touchPoints, batteryStatus }) {
  const { buttonMap } = inputConfig;

  collectCircularityData(changes.sticks, ll_data, rr_data);
  update_stick_graphics(changes);
  update_ds_button_svg(changes, buttonMap);
  update_touchpad_circles(touchPoints);

  update_battery_status(batteryStatus);
}

function handleNvStatusUpdate(nv) {
}

window.gboot = gboot;
window.connect = connect;
window.disconnect = disconnectSync;

gboot();
