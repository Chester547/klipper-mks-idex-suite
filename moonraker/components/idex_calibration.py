"""Modulo 2: calibracion de offsets IDEX por camara + perfiles de rendimiento.

Se registra en moonraker.conf como [idex_calibration]. Expone:
  GET  /server/mks_suite/camera_profiles[?profile_id=...]
  POST /server/mks_suite/camera_profiles/save
  POST /server/mks_suite/camera_profiles/delete
  POST /server/mks_suite/idex/start            (body: {hardware_profile_id, camera_id})
  POST /server/mks_suite/idex/select_tool      (body: {tool: "T0"|"T1"})
  POST /server/mks_suite/idex/jog              (body: {axis: "X"|"Y", distance, direction})
  POST /server/mks_suite/idex/home_reference
  POST /server/mks_suite/idex/capture_offset   (body: {tool: "T1"})
  GET  /server/mks_suite/idex/session
  GET  /server/mks_suite/idex/calibration?hardware_profile_id=...
  POST /server/mks_suite/performance/set       (body: {mode: "quiet"|"balanced"|"sport"})
  GET  /server/mks_suite/performance/status

Todo movimiento real de motores ocurre dentro de macros G-code
(config_templates/macros/idex_calibration_macros.cfg), no en Python: asi el
mismo flujo funciona igual desde la consola de Mainsail/Fluidd o la LCD.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from jsonschema import ValidationError

from .mks_suite_common import (
    SUITE_NAMESPACE,
    ProfileStore,
    SuitePaths,
    compute_idex_offset,
    load_schema,
    validate_against_schema,
)

logger = logging.getLogger(__name__)

VALID_MODES = ("quiet", "balanced", "sport")
PERFORMANCE_MACROS = {
    "quiet": "MKS_PERFORMANCE_QUIET",
    "balanced": "MKS_PERFORMANCE_BALANCED",
    "sport": "MKS_PERFORMANCE_SPORT",
}
JOG_FEEDRATE_MM_MIN = 300


class IdexCalibration:
    def __init__(self, config) -> None:
        self.server = config.get_server()
        self.paths = SuitePaths(config)
        self.camera_store = ProfileStore(self.paths, "camera", "camera_profile.schema.json")
        self.calibration_schema = load_schema(self.paths.schema_path, "calibration_data.schema.json")

        self.database = self.server.lookup_component("database")
        self.database.register_local_namespace(SUITE_NAMESPACE)

        try:
            self.server.register_static_file_handler("/mks-suite/ui", str(self.paths.repo_path / "frontend"))
        except Exception:
            logger.info("mks_suite: static handler /mks-suite/ui ya estaba registrado")

        eps = [
            ("/server/mks_suite/camera_profiles", ["GET"], self._handle_camera_list_or_get),
            ("/server/mks_suite/camera_profiles/save", ["POST"], self._handle_camera_save),
            ("/server/mks_suite/camera_profiles/delete", ["POST"], self._handle_camera_delete),
            ("/server/mks_suite/idex/start", ["POST"], self._handle_start),
            ("/server/mks_suite/idex/select_tool", ["POST"], self._handle_select_tool),
            ("/server/mks_suite/idex/jog", ["POST"], self._handle_jog),
            ("/server/mks_suite/idex/home_reference", ["POST"], self._handle_home_reference),
            ("/server/mks_suite/idex/capture_offset", ["POST"], self._handle_capture_offset),
            ("/server/mks_suite/idex/session", ["GET"], self._handle_get_session),
            ("/server/mks_suite/idex/calibration", ["GET"], self._handle_get_calibration),
            ("/server/mks_suite/performance/set", ["POST"], self._handle_set_performance),
            ("/server/mks_suite/performance/status", ["GET"], self._handle_get_performance),
        ]
        for path, methods, cb in eps:
            self.server.register_endpoint(path, methods, cb)

    def _klippy(self):
        return self.server.lookup_component("klippy_apis")

    # ---- perfiles de camara ----------------------------------------------

    async def _handle_camera_list_or_get(self, web_request) -> dict:
        profile_id = web_request.get_str("profile_id", None)
        if profile_id:
            profile = self.camera_store.get(profile_id)
            if profile is None:
                raise self.server.error(f"perfil de camara '{profile_id}' no existe", 404)
            return profile
        return {"profiles": self.camera_store.list()}

    async def _handle_camera_save(self, web_request) -> dict:
        profile = web_request.get("profile", None)
        if not isinstance(profile, dict):
            raise self.server.error("falta 'profile' (objeto) en el cuerpo de la peticion", 400)
        try:
            return self.camera_store.save(profile)
        except ValidationError as exc:
            raise self.server.error(f"perfil de camara invalido: {exc}", 400)
        except ValueError as exc:
            raise self.server.error(str(exc), 400)

    async def _handle_camera_delete(self, web_request) -> dict:
        profile_id = web_request.get_str("profile_id")
        if not self.camera_store.delete(profile_id):
            raise self.server.error(f"perfil de camara '{profile_id}' no existe", 404)
        return {"deleted": profile_id}

    # ---- sesion de calibracion IDEX ---------------------------------------

    async def _get_camera_ref(self, camera_id: str) -> dict:
        camera = self.camera_store.get(camera_id)
        if camera is None:
            raise self.server.error(f"perfil de camara '{camera_id}' no existe", 404)
        mount = camera.get("mount", {})
        return {
            "x": mount.get("reference_x", 110),
            "y": mount.get("reference_y", 110),
            "z_clearance": mount.get("reference_z_clearance", 5),
        }

    async def _save_session(self, session: dict) -> None:
        await self.database.insert_item(SUITE_NAMESPACE, ["session"], session)

    async def _handle_start(self, web_request) -> dict:
        hw_id = web_request.get_str("hardware_profile_id")
        cam_id = web_request.get_str("camera_id")
        ref = await self._get_camera_ref(cam_id)
        klippy_apis = self._klippy()

        await klippy_apis.run_gcode("G28")
        await klippy_apis.run_gcode(
            f"SAVE_VARIABLE VARIABLE=mks_cam_ref_x VALUE={ref['x']}\n"
            f"SAVE_VARIABLE VARIABLE=mks_cam_ref_y VALUE={ref['y']}\n"
            f"SAVE_VARIABLE VARIABLE=mks_cam_ref_z_clear VALUE={ref['z_clearance']}"
        )
        await klippy_apis.run_gcode("T0")
        await klippy_apis.run_gcode("MKS_CAM_GOTO_REF")

        session = {
            "hardware_profile_id": hw_id,
            "camera_id": cam_id,
            "active_tool": "T0",
            "reference": ref,
            "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        await self._save_session(session)
        self.server.send_event("idex_calibration:session_started", session)
        return session

    async def _handle_select_tool(self, web_request) -> dict:
        tool = web_request.get_str("tool")
        if tool not in ("T0", "T1"):
            raise self.server.error("tool debe ser 'T0' o 'T1'", 400)
        klippy_apis = self._klippy()
        await klippy_apis.run_gcode(tool)
        await klippy_apis.run_gcode("MKS_CAM_GOTO_REF")

        session = await self.database.get_item(SUITE_NAMESPACE, ["session"], default={})
        session["active_tool"] = tool
        await self._save_session(session)
        return session

    async def _handle_jog(self, web_request) -> dict:
        axis = web_request.get_str("axis")
        distance = web_request.get_float("distance")
        direction = web_request.get_int("direction")
        if axis not in ("X", "Y"):
            raise self.server.error("axis debe ser 'X' o 'Y'", 400)
        if direction not in (1, -1):
            raise self.server.error("direction debe ser 1 o -1", 400)
        if not (0 < distance <= 25):
            raise self.server.error("distance fuera de rango (0, 25] mm", 400)

        delta = round(distance * direction, 4)
        script = f"G91\nG1 {axis}{delta} F{JOG_FEEDRATE_MM_MIN}\nG90"
        klippy_apis = self._klippy()
        await klippy_apis.run_gcode(script)

        status = await klippy_apis.query_objects({"toolhead": ["position"]})
        return {"position": status["toolhead"]["position"]}

    async def _handle_home_reference(self, web_request) -> dict:
        klippy_apis = self._klippy()
        await klippy_apis.run_gcode("MKS_CAM_GOTO_REF")
        status = await klippy_apis.query_objects({"toolhead": ["position"]})
        return {"position": status["toolhead"]["position"]}

    async def _handle_capture_offset(self, web_request) -> dict:
        tool = web_request.get_str("tool")
        if tool not in ("T0", "T1"):
            raise self.server.error("tool debe ser 'T0' o 'T1'", 400)

        session = await self.database.get_item(SUITE_NAMESPACE, ["session"], default=None)
        if not session:
            raise self.server.error("no hay una sesion de calibracion activa (llama a /idex/start primero)", 400)

        klippy_apis = self._klippy()
        status = await klippy_apis.query_objects({"toolhead": ["position"], "save_variables": ["variables"]})
        pos = status["toolhead"]["position"]
        variables = status.get("save_variables", {}).get("variables", {})
        ref_x = variables.get("mks_cam_ref_x", session["reference"]["x"])
        ref_y = variables.get("mks_cam_ref_y", session["reference"]["y"])

        offset_x, offset_y = compute_idex_offset(ref_x, ref_y, pos[0], pos[1], tool)

        if tool == "T1":
            await klippy_apis.run_gcode(
                f"SET_GCODE_OFFSET X={offset_x} Y={offset_y} MOVE=1\n"
                f"SAVE_VARIABLE VARIABLE=mks_idex_offset_x VALUE={offset_x}\n"
                f"SAVE_VARIABLE VARIABLE=mks_idex_offset_y VALUE={offset_y}"
            )

        record = {
            "hardware_profile_id": session["hardware_profile_id"],
            "camera_id": session["camera_id"],
            "current": {
                "x": offset_x,
                "y": offset_y,
                "z": 0.0,
                "method": "manual_jog",
                "reference_position": {"x": ref_x, "y": ref_y},
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        }
        existing = await self.database.get_item(
            SUITE_NAMESPACE, ["calibration", session["hardware_profile_id"]], default=None
        )
        history = existing.get("history", []) if existing else []
        if existing and "current" in existing:
            history.append(existing["current"])
        record["history"] = history[-20:]

        try:
            validate_against_schema(record, self.calibration_schema)
        except ValidationError as exc:
            raise self.server.error(f"registro de calibracion invalido: {exc}", 500)

        await self.database.insert_item(SUITE_NAMESPACE, ["calibration", session["hardware_profile_id"]], record)
        self.server.send_event("idex_calibration:offset_captured", record)
        return record

    async def _handle_get_session(self, web_request) -> dict:
        return await self.database.get_item(SUITE_NAMESPACE, ["session"], default={})

    async def _handle_get_calibration(self, web_request) -> dict:
        hw_id = web_request.get_str("hardware_profile_id")
        record = await self.database.get_item(SUITE_NAMESPACE, ["calibration", hw_id], default=None)
        if record is None:
            raise self.server.error(f"sin calibracion guardada para '{hw_id}'", 404)
        return record

    # ---- perfiles de rendimiento -------------------------------------------

    async def _handle_set_performance(self, web_request) -> dict:
        mode = web_request.get_str("mode")
        if mode not in VALID_MODES:
            raise self.server.error(f"mode debe ser uno de {VALID_MODES}", 400)
        klippy_apis = self._klippy()
        await klippy_apis.run_gcode(PERFORMANCE_MACROS[mode])
        await self.database.insert_item(SUITE_NAMESPACE, ["performance", "active"], mode)
        self.server.send_event("idex_calibration:performance_changed", {"active": mode})
        return {"active": mode}

    async def _handle_get_performance(self, web_request) -> dict:
        active = await self.database.get_item(SUITE_NAMESPACE, ["performance", "active"], default="balanced")
        return {"active": active}


def load_component(config):
    return IdexCalibration(config)
