// Asistente de configuracion (Modulo 1). Vanilla JS, sin build step.

const STEP_NAMES = [
  "Placa base",
  "Cinematica",
  "Drivers",
  "Hotends / Extrusores",
  "Perifericos",
  "MCUs secundarias",
  "Confirmar y aplicar",
];

const state = {
  profile: makeEmptyProfile(),
  catalog: null,
  profiles: [],
  step: 0,
  dirty: false,
  activeToolheadTab: "T0",
  renderPreview: null,
  activeRenderFile: null,
};

function makeEmptyProfile() {
  return {
    profile_id: "",
    name: "",
    suite_schema_version: 1,
    board: { id: "mks_robin_nano_v2", mcu: "", baud: 250000, verified_pinout: false },
    kinematics: "cartesian",
    secondary_mcus: [],
    drivers: {},
    toolheads: [
      { id: "T0", hotend: "generic", extruder: "generic", nozzle_diameter: 0.4,
        thermistor_type: "ATC Semitec 104GT-2", max_temp: 300, min_temp: 0 },
    ],
    probe: { type: "none" },
    filament_sensor: { enabled: false },
    leds: [],
    performance_profile_defaults: { active: "balanced" },
  };
}

// ---- utilidades de path (data-bind="board.mcu", "leds.0.name", ...) --------

function pathGet(obj, path, def) {
  const v = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  return v === undefined ? def : v;
}
function pathSet(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function optionsHtml(list, current) {
  return list.map((o) => `<option value="${esc(o.id)}" ${o.id === current ? "selected" : ""}>${esc(o.label)}</option>`).join("");
}

function markDirty() {
  state.dirty = true;
  document.getElementById("statusBadge").textContent = "Sin guardar";
  document.getElementById("statusBadge").className = "mks-badge warn";
}

function toast(message, isError) {
  const el = document.createElement("div");
  el.className = "mks-toast" + (isError ? " error" : "");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3500);
}

// ---- binding generico --------------------------------------------------

function wireBindings(container) {
  container.querySelectorAll("[data-bind]").forEach((el) => {
    const path = el.dataset.bind;
    const current = pathGet(state.profile, path, el.dataset.default ?? "");
    if (el.type === "checkbox") el.checked = !!current;
    else el.value = current ?? "";

    const evt = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
    el.addEventListener(evt, () => {
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (el.dataset.number) v = v === "" ? undefined : Number(v);
      pathSet(state.profile, path, v);
      markDirty();
      if (el.dataset.rerender) renderStep();
    });
  });

  container.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => handleAction(el.dataset.action, el.dataset.arg));
  });
}

function handleAction(action, arg) {
  if (action === "add-led") {
    state.profile.leds.push({ name: `led_${state.profile.leds.length + 1}`, type: "ws2812", pin: "", chain_count: 8, use_led_effect: false });
  } else if (action === "remove-led") {
    state.profile.leds.splice(Number(arg), 1);
  } else if (action === "add-mcu") {
    state.profile.secondary_mcus.push({ name: `mcu_${state.profile.secondary_mcus.length + 1}`, type: "stm32_generic", serial: "", baud: 250000, restart_method: "command" });
  } else if (action === "remove-mcu") {
    state.profile.secondary_mcus.splice(Number(arg), 1);
  } else if (action === "toolhead-tab") {
    state.activeToolheadTab = arg;
  } else if (action === "select-render-file") {
    state.activeRenderFile = arg;
  }
  markDirty();
  renderStep();
}

function ensureDriver(axis) {
  if (!state.profile.drivers[axis]) {
    state.profile.drivers[axis] = { model: "tmc2209", interface: "uart", run_current: 0.6, hold_current_ratio: 0.5 };
  }
  return state.profile.drivers[axis];
}

function axesForProfile() {
  const base = ["stepper_x", "stepper_y", "stepper_z", "extruder"];
  if (state.profile.kinematics === "idex") base.push("dual_carriage", "extruder1");
  return base;
}

// ---- pasos ---------------------------------------------------------------

function renderStepBoard() {
  const boards = state.catalog.boards;
  return `
    <div class="mks-card">
      <h3>Placa base (MCU principal)</h3>
      <p class="hint">Selecciona tu placa. Los pines se generan desde referencias verificadas cuando es posible -- igual revisa docs/INSTALL.md antes de la primera puesta en marcha.</p>
      <div class="mks-grid">
        <div class="mks-field">
          <label>Placa</label>
          <select data-bind="board.id" data-rerender="1">${optionsHtml(boards, state.profile.board.id)}</select>
        </div>
        <div class="mks-field">
          <label>Puerto serie del MCU</label>
          <input type="text" data-bind="board.mcu" placeholder="/dev/serial/by-id/usb-Klipper_..." />
        </div>
        <div class="mks-field">
          <label>Baudrate</label>
          <input type="number" data-bind="board.baud" data-number="1" />
        </div>
        <div class="mks-field">
          <label class="mks-checkbox" style="margin-top:22px;">
            <input type="checkbox" data-bind="board.verified_pinout" /> Ya verifique el pinout contra mi placa fisica
          </label>
        </div>
      </div>
    </div>`;
}

function renderStepKinematics() {
  const opts = state.catalog.kinematics;
  return `
    <div class="mks-card">
      <h3>Cinematica</h3>
      <p class="hint">IDEX agrega un segundo carro X (T1) independiente -- se usara en los pasos de Drivers y Hotends, y habilita el Modulo 2 (calibracion por camara).</p>
      <div class="mks-field" style="max-width:320px;">
        <label>Tipo</label>
        <select data-bind="kinematics" data-rerender="1">${optionsHtml(opts, state.profile.kinematics)}</select>
      </div>
    </div>`;
}

function driverCardHtml(axis) {
  const d = ensureDriver(axis);
  const isExtra = axis === "dual_carriage" || axis === "extruder1";
  return `
    <div class="mks-card">
      <h3>${esc(axis)}</h3>
      <div class="mks-grid cols-3">
        <div class="mks-field">
          <label>Driver</label>
          <select data-bind="drivers.${axis}.model" data-rerender="1">${optionsHtml(state.catalog.driver_models, d.model)}</select>
        </div>
        <div class="mks-field">
          <label>Interfaz</label>
          <select data-bind="drivers.${axis}.interface">
            <option value="uart" ${d.interface === "uart" ? "selected" : ""}>UART</option>
            <option value="spi" ${d.interface === "spi" ? "selected" : ""}>SPI</option>
            <option value="standalone" ${d.interface === "standalone" ? "selected" : ""}>Standalone</option>
          </select>
        </div>
        <div class="mks-field">
          <label>Corriente (A)</label>
          <input type="number" step="0.05" data-bind="drivers.${axis}.run_current" data-number="1" />
        </div>
        <div class="mks-field">
          <label>UART pin</label>
          <input type="text" data-bind="drivers.${axis}.uart_pin" placeholder="ej. PD5" />
        </div>
        <div class="mks-field">
          <label>CS pin (SPI)</label>
          <input type="text" data-bind="drivers.${axis}.cs_pin" />
        </div>
        <div class="mks-field">
          <label class="mks-checkbox" style="margin-top:22px;">
            <input type="checkbox" data-bind="drivers.${axis}.sensorless_homing" data-rerender="1" /> Sensorless homing
          </label>
        </div>
        ${d.sensorless_homing ? `
        <div class="mks-field">
          <label>DIAG pin</label>
          <input type="text" data-bind="drivers.${axis}.diag_pin" placeholder="ej. ^PA15" />
        </div>
        <div class="mks-field">
          <label>SGTHRS (sensibilidad)</label>
          <input type="number" data-bind="drivers.${axis}.driver_sgthrs" data-number="1" data-default="75" />
        </div>` : ""}
      </div>
      ${isExtra ? `
      <p class="hint" style="margin-top:14px;">Pines fisicos de tu modificacion (no vienen de la plantilla de placa):</p>
      <div class="mks-grid cols-3">
        <div class="mks-field"><label>step_pin</label><input type="text" data-bind="drivers.${axis}.step_pin" /></div>
        <div class="mks-field"><label>dir_pin</label><input type="text" data-bind="drivers.${axis}.dir_pin" /></div>
        <div class="mks-field"><label>enable_pin</label><input type="text" data-bind="drivers.${axis}.enable_pin" /></div>
        ${axis === "dual_carriage" ? `
        <div class="mks-field"><label>endstop_pin</label><input type="text" data-bind="drivers.${axis}.endstop_pin" /></div>
        <div class="mks-field"><label>position_endstop</label><input type="number" data-bind="drivers.${axis}.position_endstop" data-number="1" /></div>
        <div class="mks-field"><label>position_max</label><input type="number" data-bind="drivers.${axis}.position_max" data-number="1" /></div>
        <div class="mks-field"><label>safe_distance</label><input type="number" data-bind="drivers.${axis}.safe_distance" data-number="1" data-default="40" /></div>` : ""}
      </div>` : ""}
    </div>`;
}

function renderStepDrivers() {
  return axesForProfile().map(driverCardHtml).join("");
}

function toolheadCardHtml(id) {
  let th = state.profile.toolheads.find((t) => t.id === id);
  if (!th) {
    th = { id, hotend: "generic", extruder: "generic", nozzle_diameter: 0.4, thermistor_type: "ATC Semitec 104GT-2", max_temp: 300, min_temp: 0 };
    state.profile.toolheads.push(th);
  }
  const idx = state.profile.toolheads.indexOf(th);
  const isT1 = id === "T1";
  return `
    <div class="mks-card">
      <div class="mks-grid cols-3">
        <div class="mks-field"><label>Hotend</label>
          <select data-bind="toolheads.${idx}.hotend">${optionsHtml(state.catalog.hotends, th.hotend)}</select>
        </div>
        <div class="mks-field"><label>Extrusor</label>
          <select data-bind="toolheads.${idx}.extruder">${optionsHtml(state.catalog.extruders, th.extruder)}</select>
        </div>
        <div class="mks-field"><label>Diametro boquilla</label>
          <input type="number" step="0.05" data-bind="toolheads.${idx}.nozzle_diameter" data-number="1" />
        </div>
        <div class="mks-field"><label>Termistor</label>
          <input type="text" data-bind="toolheads.${idx}.thermistor_type" />
        </div>
        <div class="mks-field"><label>Temp minima</label>
          <input type="number" data-bind="toolheads.${idx}.min_temp" data-number="1" />
        </div>
        <div class="mks-field"><label>Temp maxima</label>
          <input type="number" data-bind="toolheads.${idx}.max_temp" data-number="1" />
        </div>
      </div>
      ${isT1 ? `
      <p class="hint" style="margin-top:14px;">Pines del E1 (zocalo prestado / modificacion fisica):</p>
      <div class="mks-grid cols-3">
        <div class="mks-field"><label>heater_pin</label><input type="text" data-bind="toolheads.${idx}.heater_pin" /></div>
        <div class="mks-field"><label>sensor_pin</label><input type="text" data-bind="toolheads.${idx}.sensor_pin" /></div>
      </div>
      <p class="hint" style="margin-top:10px;">El offset X/Y real se calibra en el Modulo 2 (camara); aqui solo queda registrado el ultimo valor aplicado.</p>
      <div class="mks-grid cols-3">
        <div class="mks-field"><label>offset X</label><input type="number" step="0.01" data-bind="toolheads.${idx}.gcode_offset.x" data-number="1" data-default="0" /></div>
        <div class="mks-field"><label>offset Y</label><input type="number" step="0.01" data-bind="toolheads.${idx}.gcode_offset.y" data-number="1" data-default="0" /></div>
        <div class="mks-field"><label>offset Z</label><input type="number" step="0.01" data-bind="toolheads.${idx}.gcode_offset.z" data-number="1" data-default="0" /></div>
      </div>` : ""}
    </div>`;
}

function renderStepToolheads() {
  const isIdex = state.profile.kinematics === "idex";
  const tabs = isIdex ? ["T0", "T1"] : ["T0"];
  if (!isIdex) state.activeToolheadTab = "T0";
  const tabsHtml = tabs.map((t) => `<span class="mks-toolhead-tab ${state.activeToolheadTab === t ? "active" : ""}" data-action="toolhead-tab" data-arg="${t}">${t}</span>`).join("");
  return `<div style="margin-bottom:12px;">${tabsHtml}</div>` + toolheadCardHtml(state.activeToolheadTab);
}

function renderStepPeripherals() {
  const p = state.profile.probe || (state.profile.probe = { type: "none" });
  const fs = state.profile.filament_sensor || (state.profile.filament_sensor = { enabled: false });
  const ledsHtml = state.profile.leds.map((led, i) => `
    <div class="mks-list-item">
      <div class="fields">
        <input type="text" data-bind="leds.${i}.name" value="${esc(led.name)}" placeholder="nombre" />
        <input type="text" data-bind="leds.${i}.pin" value="${esc(led.pin)}" placeholder="pin" />
        <input type="number" data-bind="leds.${i}.chain_count" data-number="1" value="${led.chain_count}" placeholder="cantidad LEDs" />
        <label class="mks-checkbox"><input type="checkbox" data-bind="leds.${i}.use_led_effect" ${led.use_led_effect ? "checked" : ""} /> led_effect</label>
      </div>
      <button class="mks-btn danger" data-action="remove-led" data-arg="${i}">Quitar</button>
    </div>`).join("");

  return `
    <div class="mks-card">
      <h3>Sonda (probe)</h3>
      <div class="mks-grid cols-3">
        <div class="mks-field"><label>Tipo</label>
          <select data-bind="probe.type" data-rerender="1">${optionsHtml(state.catalog.probes, p.type)}</select>
        </div>
        ${p.type !== "none" ? `
        <div class="mks-field"><label>Pin de señal</label><input type="text" data-bind="probe.pin" /></div>
        <div class="mks-field"><label>Pin de control/servo</label><input type="text" data-bind="probe.servo_pin" /></div>
        <div class="mks-field"><label>Offset X</label><input type="number" step="0.1" data-bind="probe.x_offset" data-number="1" data-default="0" /></div>
        <div class="mks-field"><label>Offset Y</label><input type="number" step="0.1" data-bind="probe.y_offset" data-number="1" data-default="0" /></div>
        <div class="mks-field"><label>Offset Z</label><input type="number" step="0.01" data-bind="probe.z_offset" data-number="1" data-default="0" /></div>` : ""}
      </div>
    </div>
    <div class="mks-card">
      <h3>Sensor de filamento</h3>
      <label class="mks-checkbox"><input type="checkbox" data-bind="filament_sensor.enabled" data-rerender="1" /> Habilitado</label>
      ${fs.enabled ? `<div class="mks-field" style="max-width:320px;margin-top:10px;"><label>Pin</label><input type="text" data-bind="filament_sensor.pin" /></div>` : ""}
    </div>
    <div class="mks-card">
      <h3>Tiras LED (WS2812B)</h3>
      <p class="hint">"led_effect" es un plugin de terceros -- si no lo instalaste, deja esa casilla sin marcar.</p>
      ${ledsHtml}
      <button class="mks-btn secondary" data-action="add-led">+ Agregar tira LED</button>
    </div>`;
}

function renderStepSecondaryMcus() {
  const rows = state.profile.secondary_mcus.map((mcu, i) => `
    <div class="mks-list-item">
      <div class="fields">
        <input type="text" data-bind="secondary_mcus.${i}.name" value="${esc(mcu.name)}" placeholder="nombre" />
        <select data-bind="secondary_mcus.${i}.type">${optionsHtml(state.catalog.secondary_mcu_types, mcu.type)}</select>
        <input type="text" data-bind="secondary_mcus.${i}.serial" value="${esc(mcu.serial)}" placeholder="/dev/serial/by-id/..." />
        <input type="number" data-bind="secondary_mcus.${i}.baud" data-number="1" value="${mcu.baud}" />
      </div>
      <button class="mks-btn danger" data-action="remove-mcu" data-arg="${i}">Quitar</button>
    </div>`).join("");
  return `
    <div class="mks-card">
      <h3>MCUs secundarias (experimental)</h3>
      <p class="hint">Arduino/STM32/ESP32 adicionales. Se generan como [mcu &lt;nombre&gt;] independientes; conectalos a steppers/heaters manualmente editando el .cfg generado.</p>
      ${rows}
      <button class="mks-btn secondary" data-action="add-mcu">+ Agregar MCU secundaria</button>
    </div>`;
}

function renderPreviewHtml() {
  if (!state.renderPreview) return "";
  const files = Object.keys(state.renderPreview);
  if (!state.activeRenderFile) state.activeRenderFile = files[0];
  const list = files.map((f) => `<div class="${f === state.activeRenderFile ? "active" : ""}" data-action="select-render-file" data-arg="${f}">${esc(f)}</div>`).join("");
  return `
    <div class="mks-render-preview">
      <div class="file-list">${list}</div>
      <pre>${esc(state.renderPreview[state.activeRenderFile] || "")}</pre>
    </div>`;
}

function renderStepConfirm() {
  return `
    <div class="mks-card">
      <h3>Identificacion del perfil</h3>
      <div class="mks-grid">
        <div class="mks-field"><label>ID (slug, sin espacios)</label><input type="text" data-bind="profile_id" placeholder="ej. mi-corexy-monster8" /></div>
        <div class="mks-field"><label>Nombre visible</label><input type="text" data-bind="name" placeholder="ej. CoreXY IDEX taller" /></div>
      </div>
    </div>
    <div class="mks-safety-note">
      Antes de aplicar: verifica heater_pin/sensor_pin contra tu placa fisica y ten
      supervision directa en la primera puesta en marcha. Ver docs/INSTALL.md.
    </div>
    <div class="mks-card">
      <h3>Previsualizar archivos generados</h3>
      <div style="display:flex; gap:10px; margin-bottom:12px;">
        <button class="mks-btn secondary" id="renderBtn">Generar vista previa</button>
      </div>
      <div id="renderPreviewHolder">${renderPreviewHtml()}</div>
    </div>
    <div class="mks-card">
      <h3>Aplicar a printer.cfg</h3>
      <p class="hint">Escribe los .cfg en mks-suite-generated/&lt;perfil&gt;/, agrega el include a printer.cfg (con backup automatico) y opcionalmente reinicia Klipper.</p>
      <label class="mks-checkbox" style="margin-bottom:12px;"><input type="checkbox" id="restartCheck" /> Reiniciar Klipper (RESTART) despues de aplicar</label><br/>
      <button class="mks-btn" id="applyBtn">Aplicar perfil</button>
      <div id="applyResult" style="margin-top:12px;"></div>
    </div>`;
}

const STEP_RENDERERS = [
  renderStepBoard, renderStepKinematics, renderStepDrivers,
  renderStepToolheads, renderStepPeripherals, renderStepSecondaryMcus, renderStepConfirm,
];

function renderSteps() {
  const list = document.getElementById("stepList");
  list.innerHTML = STEP_NAMES.map((name, i) => `
    <li class="${i === state.step ? "active" : i < state.step ? "done" : ""}" data-action="goto-step" data-arg="${i}">
      <span class="n">${i < state.step ? "✓" : i + 1}</span> ${esc(name)}
    </li>`).join("");
  list.querySelectorAll("li").forEach((li) => li.addEventListener("click", () => { state.step = Number(li.dataset.arg); renderStep(); }));
}

function renderStep() {
  document.getElementById("pageSubtitle").textContent = `Paso ${state.step + 1} de ${STEP_NAMES.length} -- ${STEP_NAMES[state.step]}`;
  const content = document.getElementById("stepContent");
  content.innerHTML = STEP_RENDERERS[state.step]();
  wireBindings(content);
  renderSteps();

  document.getElementById("prevBtn").disabled = state.step === 0;
  document.getElementById("nextBtn").textContent = state.step === STEP_NAMES.length - 1 ? "Listo" : "Siguiente";

  const renderBtn = document.getElementById("renderBtn");
  if (renderBtn) renderBtn.addEventListener("click", doRenderPreview);
  const applyBtn = document.getElementById("applyBtn");
  if (applyBtn) applyBtn.addEventListener("click", doApply);
}

async function doRenderPreview() {
  if (!state.profile.profile_id) { toast("Asigna un ID de perfil y guardalo primero.", true); return; }
  try {
    state.profile = await MksApi.saveHardwareProfile(state.profile);
    const res = await MksApi.renderHardwareProfile(state.profile.profile_id);
    state.renderPreview = res.files;
    state.activeRenderFile = null;
    document.getElementById("renderPreviewHolder").innerHTML = renderPreviewHtml();
    wireBindings(document.getElementById("renderPreviewHolder"));
  } catch (e) {
    toast(e.message, true);
  }
}

async function doApply() {
  const restart = document.getElementById("restartCheck").checked;
  try {
    const res = await MksApi.applyHardwareProfile(state.profile.profile_id, restart);
    document.getElementById("applyResult").innerHTML =
      `<div class="mks-badge">Aplicado</div> <span class="hint">${res.files_written.length} archivos escritos${res.printer_cfg_backup ? `, backup: ${esc(res.printer_cfg_backup)}` : ""}${res.restarted ? ", Klipper reiniciado" : ""}</span>`;
    toast("Perfil aplicado.");
  } catch (e) {
    toast(e.message, true);
  }
}

async function doSave() {
  if (!state.profile.profile_id) { toast("Asigna un ID de perfil antes de guardar.", true); return; }
  try {
    state.profile = await MksApi.saveHardwareProfile(state.profile);
    state.dirty = false;
    document.getElementById("statusBadge").textContent = "Guardado";
    document.getElementById("statusBadge").className = "mks-badge";
    await refreshProfileList();
    toast("Perfil guardado.");
  } catch (e) {
    toast(e.message, true);
  }
}

async function refreshProfileList() {
  const res = await MksApi.listHardwareProfiles();
  state.profiles = res.profiles || [];
  const sel = document.getElementById("profileSelect");
  sel.innerHTML = `<option value="">-- seleccionar --</option>` +
    state.profiles.map((p) => `<option value="${esc(p.profile_id)}" ${p.profile_id === state.profile.profile_id ? "selected" : ""}>${esc(p.name || p.profile_id)}</option>`).join("");
}

async function boot() {
  try {
    state.catalog = await MksApi.getCatalog();
  } catch (e) {
    toast("No se pudo cargar el catalogo: " + e.message, true);
    return;
  }
  await refreshProfileList();
  try {
    const status = await MksApi.templateStatus();
    document.getElementById("templateStatus").textContent = status.cloned
      ? `${status.branch} @ ${status.commit}` : "sin clonar";
  } catch (e) {
    document.getElementById("templateStatus").textContent = "error";
  }

  document.getElementById("prevBtn").addEventListener("click", () => { if (state.step > 0) { state.step--; renderStep(); } });
  document.getElementById("nextBtn").addEventListener("click", () => { if (state.step < STEP_NAMES.length - 1) { state.step++; renderStep(); } });
  document.getElementById("saveBtn").addEventListener("click", doSave);
  document.getElementById("newProfileBtn").addEventListener("click", () => { state.profile = makeEmptyProfile(); state.step = 0; renderStep(); });
  document.getElementById("syncBtn").addEventListener("click", async () => {
    try { await MksApi.syncTemplates(); toast("Plantillas sincronizadas."); const s = await MksApi.templateStatus(); document.getElementById("templateStatus").textContent = `${s.branch} @ ${s.commit}`; }
    catch (e) { toast(e.message, true); }
  });
  document.getElementById("profileSelect").addEventListener("change", async (e) => {
    if (!e.target.value) return;
    try { state.profile = await MksApi.getHardwareProfile(e.target.value); state.step = 0; renderStep(); }
    catch (err) { toast(err.message, true); }
  });

  renderStep();
}

boot();
