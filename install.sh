#!/usr/bin/env bash
# install.sh -- instalador de mks-idex-suite (Modulos 1+2) para Klipper/Moonraker.
#
# Uso normal:
#   git clone https://github.com/<tu-usuario>/klipper-mks-idex-suite.git
#   cd klipper-mks-idex-suite
#   ./install.sh
#
# Variables de entorno opcionales (para instalaciones no estandar / multi-instancia):
#   KLIPPER_DIR       default: $HOME/klipper
#   MOONRAKER_DIR     default: $HOME/moonraker
#   MOONRAKER_ENV     default: $HOME/moonraker-env
#   PRINTER_DATA      default: $HOME/printer_data
#   MOONRAKER_SERVICE default: moonraker
#
# El script es idempotente: puedes volver a ejecutarlo tras un 'git pull'
# para refrescar symlinks y dependencias sin duplicar la config existente.

set -euo pipefail

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

KLIPPER_DIR="${KLIPPER_DIR:-$HOME/klipper}"
MOONRAKER_DIR="${MOONRAKER_DIR:-$HOME/moonraker}"
MOONRAKER_ENV="${MOONRAKER_ENV:-$HOME/moonraker-env}"
PRINTER_DATA="${PRINTER_DATA:-$HOME/printer_data}"
MOONRAKER_SERVICE="${MOONRAKER_SERVICE:-moonraker}"

MOONRAKER_CONF="$PRINTER_DATA/config/moonraker.conf"
COMPONENTS_DST="$MOONRAKER_DIR/moonraker/components"

log()  { printf '\033[1;32m[mks-idex-suite]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[mks-idex-suite] AVISO:\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m[mks-idex-suite] ERROR:\033[0m %s\n' "$1" >&2; exit 1; }

require_dir() {
    [ -d "$1" ] || die "no existe '$1' ($2). Ajusta la variable de entorno correspondiente o instala Klipper/Moonraker primero (ej. via KIAUH)."
}

log "Repo de la suite: $SUITE_DIR"
require_dir "$KLIPPER_DIR" "KLIPPER_DIR"
require_dir "$MOONRAKER_DIR" "MOONRAKER_DIR"
require_dir "$MOONRAKER_ENV" "MOONRAKER_ENV"
require_dir "$COMPONENTS_DST" "carpeta de componentes de Moonraker -- ¿MOONRAKER_DIR es correcto?"
[ -f "$MOONRAKER_CONF" ] || die "no existe '$MOONRAKER_CONF'. Ajusta PRINTER_DATA o crea moonraker.conf primero."

mkdir -p "$PRINTER_DATA/config/mks-suite/profiles/hardware" \
         "$PRINTER_DATA/config/mks-suite/profiles/camera" \
         "$PRINTER_DATA/config/mks-suite-generated"

# ---------------------------------------------------------------------------
log "Instalando dependencias Python en el entorno virtual de Moonraker..."
"$MOONRAKER_ENV/bin/pip" install --quiet -r "$SUITE_DIR/requirements.txt" \
    || die "fallo 'pip install' contra $MOONRAKER_ENV. Revisa que moonraker-env sea un venv valido."

# ---------------------------------------------------------------------------
log "Enlazando modulos Python dentro de moonraker/components..."
for py_file in "$SUITE_DIR"/moonraker/components/*.py; do
    name="$(basename "$py_file")"
    ln -sf "$py_file" "$COMPONENTS_DST/$name"
    log "  -> $COMPONENTS_DST/$name"
done

# ---------------------------------------------------------------------------
first_install=false
if grep -q '^\[mks_configurator\]' "$MOONRAKER_CONF" 2>/dev/null; then
    warn "moonraker.conf ya tiene una seccion [mks_configurator]; no se modifica."
    warn "Si quieres refrescar suite_repo_path, edita moonraker.conf a mano o borra ese bloque y vuelve a correr install.sh."
else
    first_install=true
    backup="$MOONRAKER_CONF.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$MOONRAKER_CONF" "$backup"
    log "Backup de moonraker.conf en: $backup"

    origin_url="$(git -C "$SUITE_DIR" remote get-url origin 2>/dev/null || true)"
    if [ -z "$origin_url" ]; then
        origin_url="https://github.com/<tu-usuario>/klipper-mks-idex-suite.git"
        warn "no se pudo detectar el remoto 'origin' de $SUITE_DIR (¿no es un checkout git?)."
        warn "Edita manualmente 'origin:' bajo [update_manager mks_idex_suite] en moonraker.conf."
    fi
    branch_name="$(git -C "$SUITE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"

    log "Agregando [mks_configurator], [idex_calibration] y [update_manager mks_idex_suite]..."
    {
        echo ""
        echo "# >>> BEGIN mks-idex-suite (agregado por install.sh) >>>"
        echo "[mks_configurator]"
        echo "suite_repo_path: $SUITE_DIR"
        echo "data_path: $PRINTER_DATA/config/mks-suite"
        echo "printer_config_root: $PRINTER_DATA/config"
        echo "printer_cfg_path: $PRINTER_DATA/config/printer.cfg"
        echo ""
        echo "[idex_calibration]"
        echo "suite_repo_path: $SUITE_DIR"
        echo "data_path: $PRINTER_DATA/config/mks-suite"
        echo "printer_config_root: $PRINTER_DATA/config"
        echo "printer_cfg_path: $PRINTER_DATA/config/printer.cfg"
        echo ""
        echo "[update_manager mks_idex_suite]"
        echo "type: git_repo"
        echo "path: $SUITE_DIR"
        echo "origin: $origin_url"
        echo "primary_branch: $branch_name"
        echo "managed_services: moonraker"
        echo "is_system_service: False"
        echo "install_script: install.sh"
        echo "requirements: requirements.txt"
        echo "# <<< END mks-idex-suite <<<"
    } >> "$MOONRAKER_CONF"
fi

# ---------------------------------------------------------------------------
log "Sincronizando macros base de Klipper (mks-idex-suite-macros/, gestionados por la suite)..."
macros_dst="$PRINTER_DATA/config/mks-idex-suite-macros"
mkdir -p "$macros_dst"
for macro_file in "$SUITE_DIR"/config_templates/macros/*.cfg; do
    name="$(basename "$macro_file")"
    cp -f "$macro_file" "$macros_dst/$name"
    log "  -> $macros_dst/$name"
done
warn "Estos archivos se sobrescriben en cada instalacion/actualizacion -- no los edites a mano, ajusta valores desde el perfil o copia el macro con otro nombre para personalizarlo."

# ---------------------------------------------------------------------------
# Solo reiniciamos Moonraker nosotros mismos en la instalacion inicial. En
# actualizaciones posteriores este script puede ser invocado por el propio
# Moonraker Update Manager (install_script), que ya reinicia el servicio via
# managed_services -- reiniciarlo tambien aqui podria cortar ese flujo a
# mitad de camino.
if [ "$first_install" = true ]; then
    if command -v sudo >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
        log "Reiniciando servicio $MOONRAKER_SERVICE..."
        sudo systemctl restart "$MOONRAKER_SERVICE" \
            || warn "no se pudo reiniciar '$MOONRAKER_SERVICE' automaticamente; reinicialo a mano."
    else
        warn "systemctl/sudo no disponibles: reinicia Moonraker manualmente para cargar los componentes nuevos."
    fi
else
    log "Configuracion ya existente: si esto NO vino de Update Manager, reinicia Moonraker a mano para aplicar cambios."
fi

cat <<EOF

$(printf '\033[1;32m%s\033[0m' "Instalacion completa.")

UI del asistente de configuracion (Modulo 1):
  http://<ip-de-tu-pi>:7125/mks-suite/ui/configurator/index.html

UI de calibracion IDEX por camara (Modulo 2):
  http://<ip-de-tu-pi>:7125/mks-suite/ui/idex_calibration/index.html

Tip: en Mainsail/Fluidd puedes agregar estos links como accesos externos
desde Settings -> Interface -> Custom Links.

Si es la primera instalacion, revisa docs/INSTALL.md antes de aplicar un
perfil de hardware: los pines de placa se generan a partir de referencias de
comunidad y DEBEN verificarse contra tu revision fisica antes de calentar
hotend/cama por primera vez.
EOF
