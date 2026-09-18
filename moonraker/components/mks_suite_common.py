"""Helpers compartidos entre mks_configurator y idex_calibration.

No se carga como componente propio: es una libreria importada por los otros dos.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

import jsonschema
from jinja2 import Environment, FileSystemLoader, StrictUndefined, TemplateNotFound
from jinja2.exceptions import UndefinedError

SUITE_NAMESPACE = "mks_idex_suite"

logger = logging.getLogger(__name__)


class SuitePaths:
    """Resuelve todas las rutas del sistema de archivos usadas por la suite.

    repo_path: checkout del repo GitHub (config_templates/, schema/, frontend/).
    data_path: <printer_data>/config/mks-suite -- perfiles y datos generados por el usuario.
    printer_cfg_path: printer.cfg real que Klipper carga.
    """

    def __init__(self, config) -> None:
        server = config.get_server()
        app_args = server.get_app_args()
        default_data_root = Path(app_args.get("data_path", "~/printer_data")).expanduser()

        self.repo_path = Path(config.get("suite_repo_path", "~/klipper-mks-idex-suite")).expanduser()
        self.data_path = Path(
            config.get("data_path", str(default_data_root / "config" / "mks-suite"))
        ).expanduser()
        self.config_root = Path(
            config.get("printer_config_root", str(default_data_root / "config"))
        ).expanduser()
        self.printer_cfg_path = Path(
            config.get("printer_cfg_path", str(self.config_root / "printer.cfg"))
        ).expanduser()

        self.templates_path = self.repo_path / "config_templates"
        self.schema_path = self.repo_path / "schema"
        self.catalog_path = self.templates_path / "catalog" / "options.json"
        self.generated_root = self.config_root / "mks-suite-generated"
        self.profiles_root = self.data_path / "profiles"

        for path in (self.data_path, self.profiles_root / "hardware", self.profiles_root / "camera",
                     self.generated_root):
            path.mkdir(parents=True, exist_ok=True)


def load_schema(schema_path: Path, name: str) -> dict:
    path = schema_path / name
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def compute_idex_offset(ref_x: float, ref_y: float, pos_x: float, pos_y: float, tool: str) -> tuple[float, float]:
    """Offset SET_GCODE_OFFSET de un toolhead respecto a T0.

    T0 es el origen por definicion (offset 0,0): la referencia de camara se
    tomo justo con T0 centrado ahi. Para T1, si su nozzle esta fisicamente
    centrado en el mismo punto (misma lectura de camara) al llegar a la
    posicion comandada (pos_x, pos_y), el offset que hace que T1 reporte esa
    misma coordenada logica que T0 usaria es la diferencia (ref - pos).
    """
    if tool == "T0":
        return (0.0, 0.0)
    return (round(ref_x - pos_x, 4), round(ref_y - pos_y, 4))


VALID_REFERENCE_MODES = ("camera", "bed_center", "bed_front", "bed_back", "manual")
# Margen de seguridad desde el borde fisico real de la cama para los presets
# "borde frontal"/"borde trasero" -- evita mandar la boquilla justo al limite
# (clips de cama, fin de carrera mecanico).
BED_EDGE_MARGIN_MM = 15


def compute_reference_point(hw_profile: dict, camera: dict, mode: str, manual_x, manual_y) -> dict:
    """Calcula el punto (x, y, z_clearance) al que se manda T0 al iniciar una calibracion.

    'camera' usa la referencia fija guardada en el perfil de camara (donde
    apunta la base magnetica); los demas modos se calculan a partir de
    bed_size_x/y del perfil de hardware. 'manual' valida que la coordenada
    quede dentro de la cama antes de aceptarla (esto termina moviendo motores
    de verdad).
    """
    bed_x = hw_profile.get("bed_size_x", 235)
    bed_y = hw_profile.get("bed_size_y", 235)
    mount = camera.get("mount", {})
    z_clearance = mount.get("reference_z_clearance", 5)

    if mode == "manual":
        if manual_x is None or manual_y is None:
            raise ValueError("reference_mode=manual requiere manual_x y manual_y")
        if not (0 <= manual_x <= bed_x) or not (0 <= manual_y <= bed_y):
            raise ValueError(
                f"coordenada manual ({manual_x}, {manual_y}) fuera de la cama "
                f"(0-{bed_x} x 0-{bed_y})"
            )
        return {"x": manual_x, "y": manual_y, "z_clearance": z_clearance}

    if mode == "bed_center":
        return {"x": round(bed_x / 2, 2), "y": round(bed_y / 2, 2), "z_clearance": z_clearance}

    if mode == "bed_front":
        return {"x": round(bed_x / 2, 2), "y": min(BED_EDGE_MARGIN_MM, bed_y / 2), "z_clearance": z_clearance}

    if mode == "bed_back":
        return {
            "x": round(bed_x / 2, 2),
            "y": round(max(bed_y - BED_EDGE_MARGIN_MM, bed_y / 2), 2),
            "z_clearance": z_clearance,
        }

    if mode != "camera":
        raise ValueError(f"reference_mode invalido: {mode!r}")

    # mode == "camera": punto fijo donde apunta la camara (montaje magnetico),
    # guardado en el perfil de camara -- comportamiento historico/default.
    return {
        "x": mount.get("reference_x", 110),
        "y": mount.get("reference_y", 110),
        "z_clearance": z_clearance,
    }


def validate_against_schema(instance: dict, schema: dict) -> None:
    """Lanza jsonschema.ValidationError con un mensaje legible si el perfil es invalido."""
    validator = jsonschema.Draft7Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda e: e.path)
    if errors:
        first = errors[0]
        loc = "/".join(str(p) for p in first.path) or "<root>"
        raise jsonschema.ValidationError(f"{loc}: {first.message}")


def slugify(value: str) -> str:
    out = []
    for ch in value.strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")[:64] or "profile"


class ProfileStore:
    """CRUD de perfiles JSON (hardware/camara) validados contra su JSON Schema."""

    def __init__(self, paths: SuitePaths, kind: str, schema_file: str) -> None:
        self.dir = paths.profiles_root / kind
        self.schema = load_schema(paths.schema_path, schema_file)
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, profile_id: str) -> Path:
        safe_id = slugify(profile_id)
        if safe_id != profile_id:
            raise ValueError(f"id de perfil invalido: {profile_id!r}")
        return self.dir / f"{profile_id}.json"

    def list(self) -> list[dict]:
        result = []
        for f in sorted(self.dir.glob("*.json")):
            try:
                result.append(json.loads(f.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("mks_suite: no se pudo leer %s: %s", f, exc)
        return result

    def get(self, profile_id: str) -> Optional[dict]:
        path = self._path(profile_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, profile: dict) -> dict:
        validate_against_schema(profile, self.schema)
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        profile.setdefault("created", now)
        profile["updated"] = now
        path = self._path(profile["profile_id"])
        tmp_path = path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(profile, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp_path.replace(path)
        return profile

    def delete(self, profile_id: str) -> bool:
        path = self._path(profile_id)
        if not path.exists():
            return False
        path.unlink()
        return True


def backup_file(path: Path) -> Optional[Path]:
    """Copia path a <path>.bak-<timestamp> antes de una modificacion automatica. None si no existia."""
    if not path.exists():
        return None
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_path = path.with_name(f"{path.name}.bak-{stamp}")
    shutil.copy2(path, backup_path)
    return backup_path


def run_git(repo_dir: Path, args: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
    """Ejecuta git en repo_dir con una lista de argumentos fija (nunca shell=True)."""
    cmd = ["git", "-C", str(repo_dir)] + args
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def _require_idex_fields(profile: dict) -> None:
    """Valida antes de renderizar que un perfil IDEX traiga los pines de T1/dual_carriage.

    Estos pines no tienen default seguro (dependen de como el usuario cablee
    el segundo carro), asi que preferimos un error claro en español aqui a
    dejar que Jinja2 StrictUndefined reviente mas abajo con menos contexto.
    """
    missing = []
    dc = profile.get("drivers", {}).get("dual_carriage")
    if not dc:
        missing.append("drivers.dual_carriage")
    else:
        for field in ("step_pin", "dir_pin", "enable_pin", "endstop_pin"):
            if not dc.get(field):
                missing.append(f"drivers.dual_carriage.{field}")

    t1 = next((t for t in profile.get("toolheads", []) if t.get("id") == "T1"), None)
    if not t1:
        missing.append("toolheads[id=T1]")
    else:
        for field in ("heater_pin", "sensor_pin"):
            if not t1.get(field):
                missing.append(f"toolheads[T1].{field}")

    d1 = profile.get("drivers", {}).get("extruder1")
    if not d1:
        missing.append("drivers.extruder1")
    else:
        for field in ("step_pin", "dir_pin", "enable_pin"):
            if not d1.get(field):
                missing.append(f"drivers.extruder1.{field}")

    if missing:
        raise ValueError(
            "perfil IDEX incompleto, faltan campos: " + ", ".join(missing)
        )


def render_templates(paths: SuitePaths, profile: dict) -> dict[str, str]:
    """Renderiza el conjunto de archivos .cfg para un HardwareProfile. No escribe a disco."""
    env = Environment(
        loader=FileSystemLoader(str(paths.templates_path)),
        undefined=StrictUndefined,
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )

    if profile["kinematics"] == "idex":
        _require_idex_fields(profile)

    outputs: dict[str, str] = {}
    ctx: dict[str, Any] = {"profile": profile, "data_path": str(paths.data_path)}

    board_id = profile["board"]["id"]
    try:
        board_tmpl = env.get_template(f"boards/{board_id}.cfg.j2")
    except TemplateNotFound as exc:
        raise ValueError(f"no existe plantilla para la placa '{board_id}'") from exc
    outputs["board.cfg"] = board_tmpl.render(**ctx)

    kinematics = profile["kinematics"]
    kin_name = "idex" if kinematics == "idex" else kinematics
    try:
        kin_tmpl = env.get_template(f"kinematics/{kin_name}.cfg.j2")
        outputs["kinematics.cfg"] = kin_tmpl.render(**ctx)
    except TemplateNotFound:
        logger.info("mks_suite: sin plantilla de cinematica dedicada para %s", kin_name)

    peripheral_map = {
        "probe": profile.get("probe", {}).get("type"),
        "filament_sensor": "switch" if profile.get("filament_sensor", {}).get("enabled") else None,
    }
    if peripheral_map["probe"] == "bltouch":
        outputs["peripherals_probe.cfg"] = env.get_template("peripherals/bltouch.cfg.j2").render(**ctx)
    if peripheral_map["filament_sensor"]:
        outputs["peripherals_filament_sensor.cfg"] = env.get_template(
            "peripherals/filament_sensor.cfg.j2"
        ).render(**ctx)
    if profile.get("leds"):
        outputs["peripherals_leds.cfg"] = env.get_template("peripherals/led_effect.cfg.j2").render(**ctx)

    for mcu in profile.get("secondary_mcus", []):
        outputs[f"mcu_{slugify(mcu['name'])}.cfg"] = env.get_template(
            f"mcu_secondary/{mcu['type']}.cfg.j2"
        ).render(mcu=mcu, **ctx)

    # main.cfg vive en <config_root>/mks-suite-generated/<profile_id>/, y los
    # macros en <config_root>/mks-idex-suite-macros/ (hermano de
    # mks-suite-generated/, no de <profile_id>/) -- por eso son DOS niveles
    # arriba, no uno. Klipper resuelve [include] relativo al archivo que lo
    # contiene, asi que esto importa de verdad.
    include_lines = ["# Generado por mks-idex-suite -- no editar a mano, se sobrescribe al re-renderizar."]
    include_lines += [f"[include {name}]" for name in outputs]
    include_lines += [
        "[include ../../mks-idex-suite-macros/performance_profiles.cfg]",
        "[include ../../mks-idex-suite-macros/idex_calibration_macros.cfg]" if kinematics == "idex" else "",
    ]
    outputs["main.cfg"] = "\n".join(line for line in include_lines if line) + "\n"

    return outputs


def write_rendered(paths: SuitePaths, profile_id: str, rendered: dict[str, str]) -> list[Path]:
    out_dir = paths.generated_root / slugify(profile_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for filename, content in rendered.items():
        target = out_dir / filename
        target.write_text(content, encoding="utf-8")
        written.append(target)

    macros_dir = paths.config_root / "mks-idex-suite-macros"
    macros_dir.mkdir(parents=True, exist_ok=True)
    for macro_file in (paths.templates_path / "macros").glob("*.cfg"):
        shutil.copy2(macro_file, macros_dir / macro_file.name)

    return written


def ensure_include_in_printer_cfg(paths: SuitePaths, profile_id: str) -> Optional[Path]:
    """Agrega '[include mks-suite-generated/<id>/main.cfg]' a printer.cfg si falta. Devuelve la ruta del backup (o None si no hizo falta)."""
    include_line = f"[include mks-suite-generated/{slugify(profile_id)}/main.cfg]"
    cfg = paths.printer_cfg_path
    text = cfg.read_text(encoding="utf-8") if cfg.exists() else ""
    if include_line in text:
        return None
    backup = backup_file(cfg)
    new_text = include_line + "\n" + text if text else include_line + "\n"
    cfg.write_text(new_text, encoding="utf-8")
    return backup
