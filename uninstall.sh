#!/usr/bin/env bash
# uninstall.sh -- retira mks-idex-suite de Moonraker sin tocar tus perfiles
# guardados ni tu printer.cfg (ver avisos al final).

set -euo pipefail

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

KLIPPER_DIR="${KLIPPER_DIR:-$HOME/klipper}"
MOONRAKER_DIR="${MOONRAKER_DIR:-$HOME/moonraker}"
PRINTER_DATA="${PRINTER_DATA:-$HOME/printer_data}"
MOONRAKER_SERVICE="${MOONRAKER_SERVICE:-moonraker}"

MOONRAKER_CONF="$PRINTER_DATA/config/moonraker.conf"
COMPONENTS_DST="$MOONRAKER_DIR/moonraker/components"

log()  { printf '\033[1;32m[mks-idex-suite]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[mks-idex-suite] AVISO:\033[0m %s\n' "$1"; }

log "Quitando symlinks de componentes Moonraker..."
for name in mks_configurator.py idex_calibration.py mks_suite_common.py; do
    target="$COMPONENTS_DST/$name"
    if [ -L "$target" ]; then
        rm -f "$target"
        log "  -> eliminado symlink $target"
    elif [ -e "$target" ]; then
        warn "$target existe pero no es un symlink; no lo toco (revisalo a mano)."
    fi
done

if [ -f "$MOONRAKER_CONF" ] && grep -q '# >>> BEGIN mks-idex-suite' "$MOONRAKER_CONF"; then
    backup="$MOONRAKER_CONF.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$MOONRAKER_CONF" "$backup"
    log "Backup de moonraker.conf en: $backup"
    sed -i '/# >>> BEGIN mks-idex-suite/,/# <<< END mks-idex-suite <<</d' "$MOONRAKER_CONF"
    log "Bloque [mks_configurator]/[idex_calibration]/[update_manager] removido de moonraker.conf."
else
    warn "No se encontro el bloque marcado de mks-idex-suite en moonraker.conf (¿ya estaba desinstalado?)."
fi

if command -v sudo >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
    log "Reiniciando servicio $MOONRAKER_SERVICE..."
    sudo systemctl restart "$MOONRAKER_SERVICE" || warn "no se pudo reiniciar '$MOONRAKER_SERVICE' automaticamente."
else
    warn "Reinicia Moonraker manualmente para que suelte los componentes."
fi

cat <<EOF

$(printf '\033[1;32m%s\033[0m' "Desinstalacion de la integracion con Moonraker completa.")

NO se borraron (por seguridad, hazlo tu mismo si ya no los necesitas):
  - Tus perfiles guardados:      $PRINTER_DATA/config/mks-suite/
  - Macros generados:            $PRINTER_DATA/config/mks-idex-suite-macros/
  - Configs por perfil aplicado: $PRINTER_DATA/config/mks-suite-generated/
  - El checkout del repo:        $SUITE_DIR

Si aplicaste algun perfil de hardware, tu printer.cfg probablemente tiene una
linea '[include mks-suite-generated/<perfil>/main.cfg]' -- quitala a mano
(y confirma que tu printer.cfg siga siendo valido) antes de borrar la carpeta
mks-suite-generated/, o Klipper fallara al iniciar por un include roto.
EOF
