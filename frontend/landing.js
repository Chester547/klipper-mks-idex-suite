// Chequeo liviano de estado usando la API core de Moonraker (no la de la suite),
// solo para las 2 pastillas de arriba. Si falla, no bloquea los botones de lanzar.

function setBadge(el, ok, textOk, textFail) {
  el.textContent = ok ? textOk : textFail;
  el.className = "mks-badge" + (ok ? "" : " danger");
}

async function checkStatus() {
  const klipperBadge = document.getElementById("klipperBadge");
  const moonrakerBadge = document.getElementById("moonrakerBadge");
  try {
    const res = await fetch("/server/info", { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const info = data.result || data;
    setBadge(moonrakerBadge, true, "Moonraker: OK", "Moonraker: error");
    const klippyOk = info.klippy_connected && info.klippy_state === "ready";
    setBadge(klipperBadge, klippyOk, "Klipper: listo", `Klipper: ${info.klippy_state || "desconectado"}`);
  } catch (e) {
    setBadge(moonrakerBadge, false, "Moonraker: OK", "Moonraker: sin conexion");
    setBadge(klipperBadge, false, "Klipper: listo", "Klipper: sin datos");
  }
}

checkStatus();
