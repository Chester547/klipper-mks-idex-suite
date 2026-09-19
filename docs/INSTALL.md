# Instalacion

## Requisitos previos

- Klipper + Moonraker ya instalados y funcionando (por ejemplo via [KIAUH](https://github.com/dw-0/kiauh)), con el layout moderno `~/printer_data/`.
- **nginx**: si ya tenes Mainsail o Fluidd accesibles normalmente ya esta instalado y `install.sh` reutiliza el mismo binario (agrega un vhost nuevo, sin tocar el de Mainsail/Fluidd). Si tu instalacion es minima (solo Klipper+Moonraker, ej. una VM de pruebas) y no lo tenes, `install.sh` lo instala solo via `apt-get` en Debian/Ubuntu -- en otras distros instalalo vos antes (`nginx` es el paquete en casi todas).
- Acceso SSH a la Raspberry Pi (u otro host) donde corre Moonraker.
- Para el Modulo 2: una camara USB (V4L2) o CSI (libcamera) ya visible para [Crowsnest](https://github.com/mainsail-crew/crowsnest), y una base magnetica o soporte fijo para apuntarla a la zona de impresion.

## Instalacion

```bash
cd ~
git clone https://github.com/<tu-usuario>/klipper-mks-idex-suite.git
cd klipper-mks-idex-suite
./install.sh
```

`install.sh` es idempotente. Si tu instalacion no usa las rutas por defecto (`~/klipper`, `~/moonraker`, `~/moonraker-env`, `~/printer_data`), exporta las variables correspondientes antes de correrlo -- ver el encabezado de [install.sh](../install.sh) para la lista completa.

Que hace exactamente:
1. Instala `jsonschema` y `Jinja2` en `moonraker-env`.
2. Symlinkea `moonraker/components/*.py` dentro de `moonraker/moonraker/components/`.
3. Agrega `[mks_configurator]`, `[idex_calibration]` y `[update_manager mks_idex_suite]` a `moonraker.conf` (con backup automatico; no hace nada si esas secciones ya existen).
4. Copia los macros base a `printer_data/config/mks-idex-suite-macros/`.
5. Agrega un vhost de nginx dedicado (puerto `7140` por defecto, variable `MKS_SUITE_PORT`) que sirve el frontend -- ver la seccion [nginx](#nginx) si algo falla aca.
6. Reinicia Moonraker (solo en la instalacion inicial -- ver comentarios en el script sobre por que no lo hace en cada actualizacion).

Al terminar, la pagina de inicio (con los botones **Wizard** y **IDEX · Calibracion asistida por camara**) queda en:

```
http://<ip-de-tu-pi>:7140/
```

**Fluidd no tiene forma de agregar links externos a su barra lateral** (no es una limitacion nuestra: la interfaz no expone esa opcion, solo temas/logo/`custom.css`). La forma practica de acceder es guardar esa direccion como favorito del navegador, o "Agregar a pantalla de inicio" en el celular -- asi se usan en la practica la mayoria de las herramientas de terceros del ecosistema Klipper cuando no hay Mainsail de por medio.

Si usas **Mainsail** (o lo sumas mas adelante), si soporta un boton real en la barra lateral via un archivo `navi.json` en tu carpeta `.theme/` de Mainsail:

```json
[
  {
    "title": "mks-idex-suite",
    "href": "http://<ip-de-tu-pi>:7140/",
    "target": "_blank",
    "position": 85
  }
]
```

Ver la [documentacion oficial de Mainsail sobre Custom Navigation](https://docs.mainsail.xyz/features/custom-themes/custom-navigation/) para agregarle un icono u otras opciones.

## nginx

El frontend **no** se sirve con el `register_static_file_handler` de Moonraker: esa API fuerza el header `Content-Disposition: attachment` en cualquier archivo que sirve (esta pensada para descargar `klippy.log`/gcode, no para hostear una pagina web), asi que el navegador termina descargando el `.html` en vez de mostrarlo -- eso es lo que viste si accediste a una URL bajo `:7125/mks-suite/ui/...` de una version vieja de este README.

En su lugar, `install.sh`:
- Instala `nginx` via `apt-get` si no lo encuentra (solo en Debian/Ubuntu; en otras distros hazlo vos antes de correr el script).
- Agrega un `server {}` nuevo y aislado (no toca tu vhost de Mainsail/Fluidd) en `/etc/nginx/sites-available/mks-idex-suite` (o `/etc/nginx/conf.d/mks-idex-suite.conf` si tu distro no usa `sites-available`), que:
  - Sirve `frontend/` como archivos estaticos (con `Content-Type` correcto, vía nginx).
  - Hace `proxy_pass` de `/websocket` y de `/server/`, `/printer/`, `/api/`, `/access/`, `/machine/` hacia Moonraker en `127.0.0.1:7125`, para que el frontend siga llamando a rutas relativas (mismo origen, sin CORS).

Antes de recargar nginx, el script corre `nginx -t`; si falla, **no** recarga nada (tu sitio actual sigue intacto) y te muestra el error. Si `install.sh` no pudo configurarlo solo (nginx no instalado, sin `sudo`, layout de directorios no reconocido), agregalo a mano con el mismo contenido -- podes copiarlo de `/etc/nginx/sites-available/mks-idex-suite` en cualquier instalacion que si haya funcionado, o pedir el bloque completo (esta documentado dentro de la funcion `setup_nginx()` en [install.sh](../install.sh)).

## Actualizaciones

Una vez instalado, Mainsail/Fluidd mostraran "mks-idex-suite" en el panel de Update Manager cuando haya commits nuevos en `main`. Un click hace `git pull` + reinstala requirements + vuelve a correr `install.sh` (via `install_script:`) + reinicia Moonraker.

Para actualizar a mano:
```bash
cd ~/klipper-mks-idex-suite
git pull
./install.sh
```

## Desinstalar

```bash
cd ~/klipper-mks-idex-suite
./uninstall.sh
```

Quita los symlinks y el bloque de `moonraker.conf`. **No** borra tus perfiles guardados, los `.cfg` generados, ni el checkout del repo -- revisa los avisos que imprime al final antes de borrar nada a mano (en particular, si aplicaste un perfil de hardware, tu `printer.cfg` tiene un `[include mks-suite-generated/...]` que debes quitar tu antes de borrar esa carpeta).

## Antes de calentar por primera vez -- checklist de seguridad

Los `.cfg` que genera el Modulo 1 usan pines de motores/heaters/fan **verificados contra los archivos oficiales de `klipper/config/`** cuando existen (ver tabla abajo). Aun asi:

1. **Nunca apliques un perfil y calientes sin supervision directa la primera vez.**
2. Abre el `.cfg` generado (`printer_data/config/mks-suite-generated/<perfil>/board.cfg`) y confirma `heater_pin` / `sensor_pin` de `[extruder]` y `[heater_bed]` contra tu placa fisica.
3. Confirma que `min_temp`/`max_temp` sean razonables para tu hardware -- no los quites ni los amplies sin motivo.
4. Los pines de `dual_carriage`/`extruder1` (IDEX) y los de `probe`/`filament_sensor`/LEDs **no vienen de ninguna referencia oficial**: son los que tu escribiste en el asistente porque dependen de tu cableado. Revisalos con doble cuidado.
5. Si algo no enciende o se comporta raro, no insistas: revisa `klippy.log` antes de reintentar.

### Confianza de pinout por placa

| Placa | Motores/heaters/fan | Fuente |
|---|---|---|
| MKS Robin Nano v1.2 | Alta | `klipper/config/generic-mks-robin-nano-v1.cfg` (documentado por Klipper como "v1.2.004") |
| MKS Robin Nano V2 | Alta | `klipper/config/generic-mks-robin-nano-v2.cfg` |
| MKS Robin Nano V3 | Alta (MCU distinto a v1/v2, ver nota en el `.cfg.j2`) | `klipper/config/generic-mks-robin-nano-v3.cfg` |
| MKS Monster8 V2 | Alta (archivo generico, no distingue V1/V2) | `klipper/config/generic-mks-monster8.cfg` |
| Creality v4.2.2 | Alta | `klipper/config/printer-creality-ender3pro-2020.cfg` (identificado como revision 4.2.2) |
| Creality v4.2.7 | Alta | `klipper/config/generic-creality-v4.2.7.cfg` |
| Creality Ender 3 MAX (stock) | Alta -- incluye BLTouch y sensor de filamento ya cableados de fabrica (deshabilitados) | `klipper/config/printer-creality-ender3max-2021.cfg` |
| MKS Robin E3 (V1.1) | Alta para motores/extruder/UART TMC2209 (viene con TMC2209 de fabrica). **Media-baja para `heater_bed`**: el propio archivo oficial de Klipper lo deja comentado/incompleto -- verifica con multimetro antes de conectar la cama | `klipper/config/generic-mks-robin-e3.cfg` |
| MKS RUMBA32 V1.0 | Alta para X/Y/Z/extruder. Zocalos E1/E2 libres para IDEX pero sin pines confirmados en el archivo oficial | `klipper/config/generic-mks-rumba32-v1.0.cfg` |
| MKS SGEN_L V1.0 | Alta (MCU LPC1768, naming de pines "P#.#" en vez de "PA/PB/PC") | `klipper/config/generic-mks-sgenl.cfg` |

En todos los casos, los `uart_pin`/`cs_pin` de TMC2209/2208 **no** vienen de los archivos oficiales genericos (son agnosticos de driver) -- son de documentacion de comunidad y tienen confianza MEDIA, **excepto** Robin E3, RUMBA32, Monster8 y SGEN_L, donde el archivo oficial SI trae esos bloques TMC comentados con pines reales (confianza ALTA, ver `suggested_driver_uart_pins` en `config_templates/catalog/options.json`).

### Drivers soportados

TMC2209, TMC2208, TMC2225 (usa la misma seccion `[tmc2208]` de Klipper -- no existe `[tmc2225]`), TMC2130 (SPI por hardware o software), y A4988/DRV8825 (standalone: sin seccion de Klipper, la corriente se ajusta con el potenciometro fisico). El wizard oculta los campos que no aplican segun el driver elegido (ej. A4988 no muestra UART/StealthChop/sensorless).

## Requisitos opcionales

- `led_effect` (github.com/julianschill/klipper-led_effect) si activas efectos de LED mas alla de color estatico -- se instala aparte, esta suite solo genera el `[led_effect]` si lo pides explicitamente.
- Crowsnest configurado con al menos una seccion `[cam N]` para el stream MJPEG que usa el Modulo 2.
