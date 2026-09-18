// Pad direccional circular (Y+/Y-/X+/X- y boton central Home) para el
// ajuste fino de la calibracion IDEX. Sin dependencias externas.

const JogPad = (() => {
  function mount(container, { onMove, onHome } = {}) {
    container.innerHTML = `
      <div class="jogpad">
        <svg viewBox="0 0 180 180">
          <circle cx="90" cy="90" r="88" fill="#12160f" stroke="#2a352f" stroke-width="1.5" />
          <g class="jog-btn" data-dir="Y+" role="button" tabindex="0" aria-label="Mover Y+"><path d="M 90 14 L 122 58 L 58 58 Z" />
            <text class="jog-label" x="90" y="44" text-anchor="middle">Y+</text></g>
          <g class="jog-btn" data-dir="Y-" role="button" tabindex="0" aria-label="Mover Y-"><path d="M 90 166 L 122 122 L 58 122 Z" />
            <text class="jog-label" x="90" y="150" text-anchor="middle">Y-</text></g>
          <g class="jog-btn" data-dir="X-" role="button" tabindex="0" aria-label="Mover X-"><path d="M 14 90 L 58 58 L 58 122 Z" />
            <text class="jog-label" x="40" y="95" text-anchor="middle">X-</text></g>
          <g class="jog-btn" data-dir="X+" role="button" tabindex="0" aria-label="Mover X+"><path d="M 166 90 L 122 58 L 122 122 Z" />
            <text class="jog-label" x="140" y="95" text-anchor="middle">X+</text></g>
          <g class="jog-btn home" data-dir="home" role="button" tabindex="0" aria-label="Volver a referencia"><circle cx="90" cy="90" r="32" />
            <text class="jog-label" x="90" y="96" text-anchor="middle" font-size="16">&#8962;</text></g>
        </svg>
      </div>`;

    const trigger = (el) => {
      const dir = el.dataset.dir;
      if (dir === "home") {
        onHome && onHome();
      } else {
        const axis = dir[0];
        const sign = dir[1] === "+" ? 1 : -1;
        onMove && onMove(axis, sign);
      }
    };

    container.querySelectorAll(".jog-btn").forEach((el) => {
      el.addEventListener("click", () => trigger(el));
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          trigger(el);
        }
      });
    });
  }

  return { mount };
})();
