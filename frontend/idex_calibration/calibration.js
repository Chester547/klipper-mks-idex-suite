// Orquesta la vista de calibracion IDEX (Modulo 2): sesion, camara, zoom,
// jog pad, captura de offset y perfiles de rendimiento.

const state = {
  hwProfiles: [],
  camProfiles: [],
  selectedHw: "",
  selectedCam: "",
  camProfile: null,
  activeTool: "T0",
  zoom: 1,
  stepMm: 0.1,
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function logActivity(msg, isError) {
  const el = document.getElementById("activityLog");
  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.style.color = isError ? "var(--danger)" : "var(--text)";
  line.textContent = `[${time}] ${msg}`;
  el.prepend(line);
}

function setActiveSeg(container, selector, matchFn) {
  container.querySelectorAll(selector).forEach((btn) => {
    btn.classList.toggle("active", matchFn(btn));
  });
}

function applyZoom() {
  const img = document.getElementById("camStream");
  img.style.transform = `scale(${state.zoom})`;
  redrawOverlay();
  setActiveSeg(document.getElementById("zoomSeg"), "button", (b) => Number(b.dataset.zoom) === state.zoom);
}

function redrawOverlay() {
  if (!state.camProfile) return;
  const svg = document.getElementById("camOverlay");
  const overlay = state.camProfile.overlay || {};
  CamOverlay.draw(svg, {
    diameterPx: overlay.reticle_diameter_px ?? 220,
    color: overlay.reticle_color ?? "#39ff6a",
    zoom: state.zoom,
  });
}

function updatePositionReadout(position) {
  if (!position) return;
  document.getElementById("posReadout").textContent = `X: ${position[0].toFixed(3)} Y: ${position[1].toFixed(3)}`;
}

async function loadCalibSummary() {
  const el = document.getElementById("calibSummary");
  if (!state.selectedHw) { el.textContent = "sin perfil de hardware"; return; }
  try {
    const rec = await MksApi.idexCalibration(state.selectedHw);
    el.innerHTML = `X: ${rec.current.x} &nbsp; Y: ${rec.current.y} <br/><span style="font-size:11px;">${esc(rec.current.timestamp)}</span>`;
  } catch (e) {
    el.textContent = "sin calibracion guardada";
  }
}

async function loadCameraProfile(id) {
  if (!id) { state.camProfile = null; document.getElementById("camPlaceholder").style.display = "flex"; return; }
  state.camProfile = await MksApi.getCameraProfile(id);
  const img = document.getElementById("camStream");
  img.src = state.camProfile.stream.mjpeg_url;
  document.getElementById("camPlaceholder").style.display = "none";
  redrawOverlay();
}

async function refreshSelects() {
  const [hwRes, camRes] = await Promise.all([MksApi.listHardwareProfiles(), MksApi.listCameraProfiles()]);
  state.hwProfiles = hwRes.profiles || [];
  state.camProfiles = camRes.profiles || [];

  const hwSel = document.getElementById("hwProfileSelect");
  hwSel.innerHTML = `<option value="">-- perfil de hardware --</option>` +
    state.hwProfiles.map((p) => `<option value="${esc(p.profile_id)}">${esc(p.name || p.profile_id)}</option>`).join("");

  const camSel = document.getElementById("camProfileSelect");
  camSel.innerHTML = `<option value="">-- perfil de camara --</option>` +
    state.camProfiles.map((p) => `<option value="${esc(p.camera_id)}">${esc(p.name || p.camera_id)}</option>`).join("");
}

async function startSession() {
  if (!state.selectedHw || !state.selectedCam) {
    logActivity("Selecciona un perfil de hardware y uno de camara antes de iniciar.", true);
    return;
  }
  try {
    const session = await MksApi.idexStart(state.selectedHw, state.selectedCam);
    document.getElementById("sessionStatus").textContent = `sesion activa -- herramienta ${session.active_tool}`;
    state.activeTool = session.active_tool;
    setActiveSeg(document.getElementById("toolSeg"), "button", (b) => b.dataset.tool === state.activeTool);
    logActivity("Sesion iniciada: G28 + T0 en la referencia de la camara.");
  } catch (e) {
    logActivity(e.message, true);
  }
}

async function selectTool(tool) {
  try {
    await MksApi.idexSelectTool(tool);
    state.activeTool = tool;
    setActiveSeg(document.getElementById("toolSeg"), "button", (b) => b.dataset.tool === tool);
    logActivity(`Herramienta activa: ${tool}`);
  } catch (e) {
    logActivity(e.message, true);
  }
}

async function jog(axis, sign) {
  try {
    const res = await MksApi.idexJog(axis, state.stepMm, sign);
    updatePositionReadout(res.position);
  } catch (e) {
    logActivity(e.message, true);
  }
}

async function homeReference() {
  try {
    const res = await MksApi.idexHomeReference();
    updatePositionReadout(res.position);
    logActivity("Vuelta a la coordenada de referencia de la camara.");
  } catch (e) {
    logActivity(e.message, true);
  }
}

async function captureOffset() {
  try {
    const rec = await MksApi.idexCaptureOffset(state.activeTool);
    logActivity(`Offset capturado para ${state.activeTool}: X=${rec.current.x} Y=${rec.current.y}`);
    await loadCalibSummary();
  } catch (e) {
    logActivity(e.message, true);
  }
}

async function setPerformanceMode(mode) {
  try {
    await MksApi.setPerformanceMode(mode);
    setActiveSeg(document.getElementById("perfSeg"), "button", (b) => b.dataset.mode === mode);
    logActivity(`Perfil de rendimiento: ${mode}`);
  } catch (e) {
    logActivity(e.message, true);
  }
}

async function boot() {
  JogPad.mount(document.getElementById("jogPadHolder"), {
    onMove: jog,
    onHome: homeReference,
  });

  try {
    await refreshSelects();
  } catch (e) {
    logActivity("No se pudieron cargar los perfiles: " + e.message, true);
  }

  try {
    const perf = await MksApi.getPerformanceMode();
    setActiveSeg(document.getElementById("perfSeg"), "button", (b) => b.dataset.mode === perf.active);
  } catch (e) { /* moonraker aun sin printer.cfg aplicado -- ignorar */ }

  document.getElementById("hwProfileSelect").addEventListener("change", async (e) => {
    state.selectedHw = e.target.value;
    await loadCalibSummary();
  });
  document.getElementById("camProfileSelect").addEventListener("change", async (e) => {
    state.selectedCam = e.target.value;
    try { await loadCameraProfile(e.target.value); } catch (err) { logActivity(err.message, true); }
  });

  document.getElementById("startBtn").addEventListener("click", startSession);
  document.getElementById("captureBtn").addEventListener("click", captureOffset);
  document.getElementById("homeRefBtn").addEventListener("click", homeReference);

  document.getElementById("toolSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tool]");
    if (btn) selectTool(btn.dataset.tool);
  });
  document.getElementById("zoomSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-zoom]");
    if (btn) { state.zoom = Number(btn.dataset.zoom); applyZoom(); }
  });
  document.getElementById("stepSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-step]");
    if (!btn) return;
    state.stepMm = Number(btn.dataset.step);
    setActiveSeg(document.getElementById("stepSeg"), "button", (b) => b === btn);
  });
  document.getElementById("perfSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (btn) setPerformanceMode(btn.dataset.mode);
  });

  applyZoom();
}

boot();
