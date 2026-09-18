// Dibuja la reticula (crosshair + circulo) sobre el stream de camara.
// El centro SIEMPRE queda fijo en el centro del viewport: representa el punto
// fisico fijo al que apunta la camara, independiente del zoom digital (que se
// aplica como CSS transform: scale() centrado sobre la imagen, nunca sobre la
// reticula).

const CamOverlay = (() => {
  const VB_W = 400;
  const VB_H = 300;

  function draw(svgEl, { diameterPx = 220, color = "#39ff6a", zoom = 1 } = {}) {
    const cx = VB_W / 2;
    const cy = VB_H / 2;
    const maxR = Math.min(VB_W, VB_H) / 2 - 6;
    const r = Math.min((diameterPx * zoom) / 2, maxR);

    svgEl.setAttribute("viewBox", `0 0 ${VB_W} ${VB_H}`);
    svgEl.innerHTML = `
      <line x1="0" y1="${cy}" x2="${VB_W}" y2="${cy}" stroke="${color}" stroke-width="1.5" opacity="0.85" />
      <line x1="${cx}" y1="0" x2="${cx}" y2="${VB_H}" stroke="${color}" stroke-width="1.5" opacity="0.85" />
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2.5" />
      <circle cx="${cx}" cy="${cy}" r="3" fill="${color}" />
    `;
  }

  return { draw };
})();
