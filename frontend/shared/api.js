// Cliente minimo para la API REST que exponen mks_configurator.py / idex_calibration.py.
// Servido por Moonraker desde el mismo origen (register_static_file_handler),
// asi que las llamadas son same-origin y no necesitan API key ni CORS.

const MksApi = (() => {
  async function request(method, path, body) {
    const opts = { method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {
      // respuesta sin cuerpo JSON
    }
    if (!res.ok) {
      const msg = (payload && (payload.error?.message || payload.message)) || res.statusText;
      throw new Error(`${method} ${path} -> ${res.status}: ${msg}`);
    }
    return payload && payload.result !== undefined ? payload.result : payload;
  }

  const get = (path) => request("GET", path);
  const post = (path, body) => request("POST", path, body ?? {});

  return {
    // Modulo 1
    getCatalog: () => get("/server/mks_suite/catalog"),
    listHardwareProfiles: () => get("/server/mks_suite/hardware_profiles"),
    getHardwareProfile: (id) => get(`/server/mks_suite/hardware_profiles?profile_id=${encodeURIComponent(id)}`),
    saveHardwareProfile: (profile) => post("/server/mks_suite/hardware_profiles/save", { profile }),
    deleteHardwareProfile: (id) => post("/server/mks_suite/hardware_profiles/delete", { profile_id: id }),
    renderHardwareProfile: (id) => post("/server/mks_suite/hardware_profiles/render", { profile_id: id }),
    applyHardwareProfile: (id, restart) =>
      post("/server/mks_suite/hardware_profiles/apply", { profile_id: id, restart: !!restart }),
    syncTemplates: () => post("/server/mks_suite/templates/sync"),
    templateStatus: () => get("/server/mks_suite/templates/status"),

    // Modulo 2 -- perfiles de camara
    listCameraProfiles: () => get("/server/mks_suite/camera_profiles"),
    getCameraProfile: (id) => get(`/server/mks_suite/camera_profiles?profile_id=${encodeURIComponent(id)}`),
    saveCameraProfile: (profile) => post("/server/mks_suite/camera_profiles/save", { profile }),
    deleteCameraProfile: (id) => post("/server/mks_suite/camera_profiles/delete", { profile_id: id }),

    // Modulo 2 -- sesion IDEX
    idexStart: (hardwareProfileId, cameraId) =>
      post("/server/mks_suite/idex/start", { hardware_profile_id: hardwareProfileId, camera_id: cameraId }),
    idexSelectTool: (tool) => post("/server/mks_suite/idex/select_tool", { tool }),
    idexJog: (axis, distance, direction) => post("/server/mks_suite/idex/jog", { axis, distance, direction }),
    idexHomeReference: () => post("/server/mks_suite/idex/home_reference"),
    idexCaptureOffset: (tool) => post("/server/mks_suite/idex/capture_offset", { tool }),
    idexSession: () => get("/server/mks_suite/idex/session"),
    idexCalibration: (hardwareProfileId) =>
      get(`/server/mks_suite/idex/calibration?hardware_profile_id=${encodeURIComponent(hardwareProfileId)}`),

    // Modulo 2 -- perfiles de rendimiento
    setPerformanceMode: (mode) => post("/server/mks_suite/performance/set", { mode }),
    getPerformanceMode: () => get("/server/mks_suite/performance/status"),
  };
})();
