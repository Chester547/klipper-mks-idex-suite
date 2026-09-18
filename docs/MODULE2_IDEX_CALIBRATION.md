# Modulo 2 -- Calibracion IDEX por camara + perfiles de rendimiento

## Hardware

- Camara USB (V4L2) o CSI (libcamera) en una base magnetica fija, apuntando a un punto conocido sobre la cama (o un jig externo), servida por [Crowsnest](https://github.com/mainsail-crew/crowsnest) como MJPEG.
- Un perfil de camara (`CameraProfile`, [`schema/camera_profile.schema.json`](../schema/camera_profile.schema.json)) guarda la URL del stream y la coordenada fisica de referencia (`mount.reference_x/y`) a la que apunta.

## Flujo de calibracion

0. **Elegir punto de referencia**: antes de iniciar, la UI deja elegir a donde va T0 -- util porque la camara tiene base magnetica y se puede reapuntar:
   - **Camara**: el punto fijo guardado en el perfil de camara (`mount.reference_x/y`) -- default historico.
   - **Centro de cama** / **Borde frontal** / **Borde trasero**: calculados a partir de `bed_size_x`/`bed_size_y` del perfil de hardware (paso "Placa base" del Modulo 1), con un margen de seguridad de 15 mm desde el borde real para los presets de borde (`BED_EDGE_MARGIN_MM` en [`mks_suite_common.py`](../moonraker/components/mks_suite_common.py)).
   - **Manual**: coordenadas X/Y que ingreses a mano; el backend valida que queden dentro de la cama (`0 <= x <= bed_size_x`, idem Y) antes de mover nada.

   Ver [`compute_reference_point`](../moonraker/components/mks_suite_common.py) y sus tests en [`tests/test_offset_calc.py`](../tests/test_offset_calc.py).

1. **Iniciar** (`POST /idex/start`): `G28`, guarda la referencia elegida en variables de Klipper (`SAVE_VARIABLE`) y manda `T0` a esa coordenada.
2. **Conmutar T0/T1** (`POST /idex/select_tool`): corre el macro `T0` o `T1` (cambia `dual_carriage` + extrusor activo) y vuelve a mandar el carro activo a la misma coordenada logica de referencia -- ahi es donde tipicamente aparece la desalineacion fisica de T1.
3. **Ajuste fino**: el pad direccional (X+/X-/Y+/Y-, pasos de 0.05/0.1/0.5/1 mm) mueve el carro activo con `G91` + `G1` + `G90` hasta que la boquilla quede centrada en la retícula verde.
4. **Capturar offset** (`POST /idex/capture_offset`): lee la posicion actual del toolhead y la referencia guardada, calcula `offset = referencia - posicion` (ver [`compute_idex_offset`](../moonraker/components/mks_suite_common.py) y su test en [`tests/test_offset_calc.py`](../tests/test_offset_calc.py)), aplica `SET_GCODE_OFFSET ... MOVE=1` de inmediato y lo persiste con `SAVE_VARIABLE` para que el macro `T1` lo vuelva a aplicar solo en cada cambio de herramienta futuro -- sin necesitar `SAVE_CONFIG` ni reiniciar Klipper.

Todo el historial de offsets capturados queda en la base de datos de Moonraker (namespace `mks_idex_suite`), con el ultimo valor y hasta 20 capturas anteriores por perfil de hardware.

### Por que no hace falta SAVE_CONFIG

`SET_GCODE_OFFSET` por si solo no sobrevive un reinicio de Klipper. En vez de forzar un `SAVE_CONFIG` (que reescribe todo `printer.cfg` y reinicia) cada vez que ajustas el offset, el macro `T1` en [`macros/idex_calibration_macros.cfg`](../config_templates/macros/idex_calibration_macros.cfg) lee `printer.save_variables.variables.mks_idex_offset_x/y` **en cada cambio de herramienta** y reaplica el offset. Ajustar la calibracion es entonces instantaneo e interactivo.

### Por que T0/T1 no saltan solos a la camara

Los macros `T0`/`T1` son los mismos que usarias en un print real (slicer start gcode incluido): solo hacen el cambio de herramienta + reponer el offset guardado. El salto a la coordenada de referencia de la camara (`MKS_CAM_GOTO_REF`) es un macro **separado** que unicamente la UI de calibracion invoca -- si viviera dentro de `T0`/`T1`, cada cambio de herramienta durante una impresion real movería el carro a la referencia de la camara en vez de a donde el slicer pidio, arruinando la impresion.

## Perfiles de rendimiento

`macros/performance_profiles.cfg` es estatico y se autoadapta: usa `printer.configfile.settings` para detectar que steppers TMC2209/TMC2208 existen realmente (funciona igual en una maquina de un solo cabezal que en IDEX).

| Perfil | TPWMTHRS | Aceleracion/velocidad |
|---|---|---|
| Silencioso | `999999` (StealthChop casi siempre) | Conservadora (1200 mm/s², 60 mm/s) |
| Balanceado | `100` (auto por velocidad) | Estandar (3000 mm/s², 150 mm/s) |
| Deportivo | `0` (SpreadCycle casi siempre) | Deliberadamente muy alta -- `SET_VELOCITY_LIMIT` nunca puede superar `max_accel`/`max_velocity` de `[printer]`, asi que en la practica usa el techo real de tu maquina sin riesgo de pasarse |

Se cambian desde la UI (`POST /performance/set`) o llamando directo a los macros `MKS_PERFORMANCE_QUIET` / `MKS_PERFORMANCE_BALANCED` / `MKS_PERFORMANCE_SPORT` desde la consola o el slicer.

## Overlay visual

`overlay.js` dibuja la reticula (crosshair + circulo) en un `<svg>` superpuesto al `<img>` del stream MJPEG. El centro de la reticula queda siempre fijo en el centro del viewport -- representa el punto fisico al que apunta la camara. El zoom digital (1x/2x/4x) se aplica como `transform: scale()` sobre la imagen, nunca sobre la reticula, para que el punto de referencia no se mueva al hacer zoom.

## Fuera de alcance (a proposito)

- Deteccion automatica de la boquilla por vision (tipo TAMV/OpenCV): el flujo pedido es de alineacion manual asistida, no auto-deteccion. El schema de calibracion deja el campo `method` abierto (`manual_jog` | `auto_vision`) por si se agrega despues, pero esta suite solo implementa `manual_jog`.
- Calibracion de offset Z entre T0/T1 por camara (la imagen de referencia muestra botones de "Thermal Expansion"/"Z-offset" de otra herramienta -- no estan en el alcance pedido). El mismo mecanismo de `save_variables` + macro puede extenderse para esto.
