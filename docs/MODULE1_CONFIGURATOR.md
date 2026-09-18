# Modulo 1 -- Configurador MKS/Creality

Asistente paso a paso (estilo RatOS) que genera un set de `.cfg` de Klipper a partir de un perfil de hardware, sin escribir pines a mano.

## Flujo

1. **Placa base**: elegis el MCU principal (ver tabla de placas soportadas en [INSTALL.md](INSTALL.md)) y el puerto serie.
2. **Cinematica**: Cartesiana, CoreXY o IDEX. IDEX agrega un segundo carro X (`T1`) en los pasos siguientes.
3. **Drivers**: por cada eje (`stepper_x/y/z`, `extruder`, y `dual_carriage`/`extruder1` si es IDEX) elegis modelo TMC, interfaz (UART/SPI/standalone), corriente, y opcionalmente sensorless homing (pin DIAG + sensibilidad SGTHRS).
4. **Hotends/Extrusores**: hotend + extrusor de una lista predeterminada, diametro de boquilla, termistor, temperaturas limite. En IDEX, `T1` ademas pide `heater_pin`/`sensor_pin` (el zocalo de E1 que reutilizaste fisicamente).
5. **Perifericos**: BLTouch/sonda inductiva con offsets X/Y/Z, sensor de filamento, tiras LED WS2812B (con soporte opcional para el plugin `led_effect`).
6. **MCUs secundarias (experimental)**: Arduino Mega2560 / STM32 generica / ESP32 adicionales.
7. **Confirmar y aplicar**: guarda el perfil, genera una vista previa de los `.cfg` resultantes, y opcionalmente los aplica (con backup de `printer.cfg` y reinicio de Klipper).

Todo el estado se guarda como un `HardwareProfile` JSON (ver [`schema/hardware_profile.schema.json`](../schema/hardware_profile.schema.json)) en `printer_data/config/mks-suite/profiles/hardware/<id>.json`.

## Como se generan los .cfg

`mks_configurator.py` no tiene los pines hardcodeados: los toma de plantillas Jinja2 en [`config_templates/`](../config_templates/):

```
config_templates/
├── boards/<placa>.cfg.j2         # [mcu], steppers, extruder T0, heater_bed, fan
├── drivers/tmc2209.cfg.j2        # macros Jinja2 reusables para bloques [tmc2209 <eje>]
├── kinematics/{cartesian,corexy,idex}.cfg.j2   # [printer] + (si es IDEX) dual_carriage/extruder1
├── peripherals/{bltouch,filament_sensor,led_effect}.cfg.j2
├── mcu_secondary/{arduino_mega2560,stm32_generic,esp32}.cfg.j2
├── macros/{performance_profiles,idex_calibration_macros}.cfg   # estaticos, ver Modulo 2
└── catalog/options.json          # listas desplegables + sugerencias de pines por placa
```

Al pedir "Render" o "Aplicar", `render_templates()` (en [`mks_suite_common.py`](../moonraker/components/mks_suite_common.py)):

1. Renderiza `boards/<placa>.cfg.j2` con el perfil completo.
2. Renderiza `kinematics/<tipo>.cfg.j2`.
3. Renderiza los perifericos que esten habilitados.
4. Genera un `main.cfg` con un `[include ...]` por cada archivo anterior, mas los macros de `macros/`.
5. Todo el render usa Jinja2 `StrictUndefined`: si falta un campo requerido (tipicamente los pines de `dual_carriage`/`extruder1` en IDEX, que no tienen default seguro), el render falla con un error explicito en vez de generar un `.cfg` con pines vacios.

"Aplicar" escribe esos archivos en `printer_data/config/mks-suite-generated/<perfil>/`, hace un backup de `printer.cfg` con timestamp, y agrega `[include mks-suite-generated/<perfil>/main.cfg]` si no estaba ya. **No** reinicia Klipper a menos que marques la casilla correspondiente.

## Placas: que esta verificado y que no

Los pines de motores/heaters/fan de las 6 placas soportadas se contrastaron contra los archivos oficiales de `klipper/config/` (ver tabla en [INSTALL.md](INSTALL.md)). Los pines de UART de TMC2209, de sondas, sensores de filamento y LEDs son sugerencias editables (`catalog/options.json -> suggested_peripheral_pins`) que **siempre** podes sobreescribir en el asistente -- nunca se usan directo en las plantillas sin pasar por tu confirmacion.

## Sincronizacion con GitHub

El boton "Sincronizar" (barra lateral) corre `git fetch` + `git pull --ff-only` sobre el checkout de `suite_repo_path` (el mismo que clonaste con `install.sh`). No acepta una URL de repo por request -- el origen se fija una vez en `moonraker.conf` para evitar que la API quede abierta a clonar remotos arbitrarios.
