'use strict';

import { sleep, float_to_str } from './utils.js';
import { initControllerManager } from './controller-manager.js';
import ControllerFactory from './controllers/controller-factory.js';
import { draw_stick_position, CIRCULARITY_DATA_SIZE } from './stick-renderer.js';

let controller = null;

function gboot() {
  // Check for WebHID support
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
  // Initialize controller manager
  controller = initControllerManager();
  controller.setInputHandler(handleControllerInput);

  try {
    $("#btnconnect").prop("disabled", true);
    $("#connectspinner").show();
    await sleep(100);

    const supportedModels = ControllerFactory.getSupportedModels();
    const requestParams = { filters: supportedModels };
    let devices = await navigator.hid.getDevices(); // Already connected?
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
      infoAlert("Please connect only one controller at a time.");
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

    // Check for proper USB connection (report length should be 63 bytes)
    const reportLen = data.byteLength;
    if(reportLen != 63) {
      infoAlert("The device is connected via Bluetooth. Disconnect and reconnect using a USB cable instead.");
      await disconnect();
      return;
    }

    // Create controller instance using factory
    const controllerInstance = ControllerFactory.createControllerInstance(device);
    controller.setControllerInstance(controllerInstance);

    const info = await controllerInstance.getInfo();

    if(!info?.ok) {
      if(info) console.error(JSON.stringify(info, null, 2));
      throw new Error(`Connected invalid device: Error 1`, { cause: info?.error });
    }

    // Assign input processor for stream
    device.oninputreport = controller.getInputHandler();

    const deviceName = ControllerFactory.getDeviceName(device.productId);
    $("#devname").text(deviceName + " (" + device.vendorId.toString(16).padStart(4, '0') + ":" + device.productId.toString(16).padStart(4, '0') + ")");

    $("#offlinebar").hide();
    $("#onlinebar").show();
    $("#mainmenu").show();

    // Initialize SVG controller based on model
    await init_svg_controller(controllerInstance.getModel());

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

// Wrapper function for HTML onclick handlers
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

  // Determine which SVG to load based on controller model
  let svgFileName;
  if (model === 'DS4') {
    svgFileName = 'dualshock-controller.svg';
  } else if (model === 'DS5' || model === 'DS5_Edge') {
    svgFileName = 'dualsense-controller.svg';
  } else {
    throw new Error(`Unknown controller model: ${model}`);
  }

  // Fetch SVG content from server
  const response = await fetch(`assets/${svgFileName}`);
  if (!response.ok) {
    throw new Error(`Failed to load controller SVG: ${svgFileName}`);
  }
  const svgContent = await response.text();

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

  const enable_zoom_center = false;
  const enable_circ_test = false;
  
  // Draw left stick
  draw_stick_position(ctx, hb, yb, sz, plx, ply, {
    circularity_data: enable_circ_test ? new Array(CIRCULARITY_DATA_SIZE).fill(0) : null,
    enable_zoom_center,
  });

  // Draw right stick
  draw_stick_position(ctx, w-hb, yb, sz, prx, pry, {
    circularity_data: enable_circ_test ? new Array(CIRCULARITY_DATA_SIZE).fill(0) : null,
    enable_zoom_center,
  });

  const precision = enable_zoom_center ? 3 : 2;
  $("#lx-lbl").text(float_to_str(plx, precision));
  $("#ly-lbl").text(float_to_str(ply, precision));
  $("#rx-lbl").text(float_to_str(prx, precision));
  $("#ry-lbl").text(float_to_str(pry, precision));

  // Move L3 and R3 SVG elements according to stick position
  try {
    switch(controller.getModel()) {
      case "DS4":
        updateSvgStickPosition('ds4', plx, ply, prx, pry);
        break;
      case "DS5":
      case "DS5_Edge":
        updateSvgStickPosition('ds5', plx, ply, prx, pry);
        break;
      default:
        return; // Unsupported model, skip
    }
  } catch (e) {
    // Fail silently if SVG not present
  }
}

function updateSvgStickPosition(controllerType, plx, ply, prx, pry) {
  // These values are tuned for the SVG's coordinate system and visual effect
  const max_stick_offset = 25;
  
  // L3 center coordinates depend on controller type
  const l3_cx = 295.63, l3_cy = 461.03;
  const r3_cx = 662.06, r3_cy = 419.78;

  const l3_x = l3_cx + plx * max_stick_offset;
  const l3_y = l3_cy + ply * max_stick_offset;
  const l3_group = document.querySelector('g#L3');
  l3_group?.setAttribute('transform', `translate(${l3_x - l3_cx},${l3_y - l3_cy})${controllerType === 'ds5' ? ' scale(0.70)' : ''}`);

  const r3_x = r3_cx + prx * max_stick_offset;
  const r3_y = r3_cy + pry * max_stick_offset;
  const r3_group = document.querySelector('g#R3');
  r3_group?.setAttribute('transform', `translate(${r3_x - r3_cx},${r3_y - r3_cy})${controllerType === 'ds5' ? ' scale(0.70)' : ''}`);
}

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

function update_battery_status({bat_txt, changed}) {
  if(changed) {
    $("#d-bat").html(bat_txt);
  }
}

function update_ds_button_svg(changes, BUTTON_MAP) {
  if (!changes || Object.keys(changes).length === 0) return;

  const pressedColor = '#1a237e';

  // Update L2/R2 analog infill
  for (const trigger of ['l2', 'r2']) {
    const key = trigger + '_analog';
    if (changes.hasOwnProperty(key)) {
      const val = changes[key];
      const t = val / 255;
      const color = `rgba(26, 35, 126, ${t})`;
      const svg = trigger.toUpperCase() + '_infill';
      const infill = document.getElementById(svg);
      set_svg_group_color(infill, color);
    }
  }

  // Update dpad buttons
  for (const dir of ['up', 'right', 'down', 'left']) {
    if (changes.hasOwnProperty(dir)) {
      const pressed = changes[dir];
      const group = document.getElementById(dir.charAt(0).toUpperCase() + dir.slice(1) + '_infill');
      set_svg_group_color(group, pressed ? pressedColor : 'white');
    }
  }

  // Update other buttons
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

function handleControllerInput({ changes, inputConfig, touchPoints, batteryStatus }) {
  const { buttonMap } = inputConfig;

  update_stick_graphics(changes);
  update_ds_button_svg(changes, buttonMap);
  update_battery_status(batteryStatus);
}

function infoAlert(message) {
  console.log("INFO:", message);
}

// Export functions to global scope for HTML onclick handlers
window.gboot = gboot;
window.connect = connect;
window.disconnect = disconnectSync;

// Auto-initialize the application when the module loads
gboot();