# Modulo 1 -- Configurador MKS/Creality

Asistente paso a paso (estilo RatOS) que genera un set de `.cfg` de Klipper a partir de un perfil de hardware, sin escribir pines a mano.

## Flujo

1. **Placa base**: elegis el MCU principal (ver tabla de placas soportadas en [INSTALL.md](INSTALL.md)) y el puerto serie.
2. **Cinematica**: Cartesiana, CoreXY o IDEX. IDEX agrega un segundo carro X (`T1`) en los pasos siguientes.
3. **Drivers**: por cada eje (`stepper_x/y/z`, `extruder`, y `dual_carriage`/`extruder1` si es IDEX) elegis modelo (TMC2209, TMC2208, TMC2225, TMC2130, A4988 o DRV8825), interfaz (UART/SPI por hardware o software/standalone), corriente, un toggle de StealthChop/SpreadCycle, y sensorless homing donde aplica (TMC2209 con DIAG+SGTHRS, TMC2130 con DIAG1+SGT). El wizard oculta los campos que no aplican al modelo elegido (A4988/DRV8825 no tienen ningun campo de software, por ejemplo). Si la placa elegida tiene pines TMC confirmados contra el archivo oficial de Klipper, aparece un boton "Sugerir pines para esta placa".
4. **Hotends/Extrusores**: hotend + extrusor de una lista predeterminada, diametro de boquilla, termistor, temperaturas limite. En IDEX, `T1` ademas pide `heater_pin`/`sensor_pin` (el zocalo de E1 que reutilizaste fisicamente).
5. **Perifericos**: BLTouch/sonda inductiva con offsets X/Y/Z, sensor de filamento, tiras LED WS2812B (con soporte opcional para el plugin `led_effect`).
6. **MCUs secundarias (experimental)**: Arduino Mega2560 / STM32 generica / ESP32 adicionales.
7. **Confirmar y aplicar**: guarda el perfil, genera una vista previa de los `.cfg` resultantes, y opcionalmente los aplica (con backup de `printer.cfg` y reinicio de Klipper).

Todo el estado se guarda como un `HardwareProfile` JSON (ver [`schema/hardware_profile.schema.json`](../schema/hardware_profile.schema.json)) en `printer_data/config/mks-suite/profiles/hardware/<id>.json`.

## Como se generan los .cfg

`mks_configurator.py` no tiene los pines hardcodeados: los toma de plantillas Jinja2 en [`config_templates/`](../config_templates/):

```
config_templates/
├── boards/<placa>.cfg.j2         # [mcu], steppers, extruder T0, heater_bed, fan (10 placas)
├── drivers/tmc_common.cfg.j2     # macros Jinja2 reusables para [tmc2208/2209/2130 <eje>]
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

Los pines de motores/heaters/fan de las 10 placas soportadas se contrastaron contra los archivos oficiales de `klipper/config/` (ver tabla en [INSTALL.md](INSTALL.md)). Los pines de UART/SPI de los drivers TMC, de sondas, sensores de filamento y LEDs son sugerencias editables (`catalog/options.json -> suggested_peripheral_pins` / `suggested_driver_uart_pins` / `suggested_extruder1_pins`) que **siempre** podes sobreescribir en el asistente -- nunca se usan directo en las plantillas sin pasar por tu confirmacion (el boton "Sugerir pines" solo precarga el campo, no aplica nada por si solo).

Distincion importante para IDEX: el zocalo "E1" de repuesto en placas de 4 drivers (Robin Nano, Robin E3) sirve para un **segundo extrusor sobre el mismo carro** (`[extruder1]` sin `[dual_carriage]`), no para IDEX de carro independiente -- para eso hace falta una placa con un zocalo de motor de sobra ademas del de extrusor (Monster8 con 8, RUMBA32 con 6).

## Sincronizacion con GitHub

El boton "Sincronizar" (barra lateral) corre `git fetch` + `git pull --ff-only` sobre el checkout de `suite_repo_path` (el mismo que clonaste con `install.sh`). No acepta una URL de repo por request -- el origen se fija una vez en `moonraker.conf` para evitar que la API quede abierta a clonar remotos arbitrarios.
