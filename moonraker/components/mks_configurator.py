"""Modulo 1: asistente de configuracion de hardware (placas MKS/Creality).

Se registra en moonraker.conf como [mks_configurator]. Expone:
  GET  /server/mks_suite/catalog
  GET  /server/mks_suite/hardware_profiles[?profile_id=...]
  POST /server/mks_suite/hardware_profiles                (body: {"profile": {...}})
  POST /server/mks_suite/hardware_profiles/delete          (body: {"profile_id": "..."})
  POST /server/mks_suite/hardware_profiles/render          (body: {"profile_id": "..."})
  POST /server/mks_suite/hardware_profiles/apply           (body: {"profile_id": "...", "restart": bool})
  POST /server/mks_suite/templates/sync
  GET  /server/mks_suite/templates/status
"""
from __future__ import annotations

import json
import logging
from typing import Any

from jinja2.exceptions import UndefinedError
from jsonschema import ValidationError

from .mks_suite_common import (
    ProfileStore,
    SuitePaths,
    ensure_include_in_printer_cfg,
    render_templates,
    run_git,
    write_rendered,
)

logger = logging.getLogger(__name__)


class MksConfigurator:
    def __init__(self, config) -> None:
        self.server = config.get_server()
        self.paths = SuitePaths(config)
        self.store = ProfileStore(self.paths, "hardware", "hardware_profile.schema.json")

        # El frontend (HTML) se sirve por nginx (install.sh agrega un vhost
        # dedicado), NO por Moonraker: su register_static_file_handler fuerza
        # 'Content-Disposition: attachment' en todo archivo (pensado para
        # descargar logs/gcode), lo que hace que el navegador descargue el
        # .html en vez de renderizarlo. Ver docs/INSTALL.md.

        self.server.register_endpoint(
            "/server/mks_suite/catalog", ["GET"], self._handle_catalog
        )
        self.server.register_endpoint(
            "/server/mks_suite/hardware_profiles", ["GET"], self._handle_list_or_get
        )
        self.server.register_endpoint(
            "/server/mks_suite/hardware_profiles/save", ["POST"], self._handle_save
        )
        self.server.register_endpoint(
            "/server/mks_suite/hardware_profiles/delete", ["POST"], self._handle_delete
        )
        self.server.register_endpoint(
            "/server/mks_suite/hardware_profiles/render", ["POST"], self._handle_render
        )
        self.server.register_endpoint(
            "/server/mks_suite/hardware_profiles/apply", ["POST"], self._handle_apply
        )
        self.server.register_endpoint(
            "/server/mks_suite/templates/sync", ["POST"], self._handle_template_sync
        )
        self.server.register_endpoint(
            "/server/mks_suite/templates/status", ["GET"], self._handle_template_status
        )

    async def _handle_catalog(self, web_request) -> dict:
        if not self.paths.catalog_path.exists():
            raise self.server.error("catalog/options.json no encontrado en el repo de plantillas", 404)
        return json.loads(self.paths.catalog_path.read_text(encoding="utf-8"))

    async def _handle_list_or_get(self, web_request) -> dict:
        profile_id = web_request.get_str("profile_id", None)
        if profile_id:
            profile = self.store.get(profile_id)
            if profile is None:
                raise self.server.error(f"perfil '{profile_id}' no existe", 404)
            return profile
        return {"profiles": self.store.list()}

    async def _handle_save(self, web_request) -> dict:
        profile = web_request.get("profile", None)
        if not isinstance(profile, dict):
            raise self.server.error("falta 'profile' (objeto) en el cuerpo de la peticion", 400)
        try:
            saved = self.store.save(profile)
        except ValidationError as exc:
            raise self.server.error(f"perfil invalido: {exc}", 400)
        except ValueError as exc:
            raise self.server.error(str(exc), 400)
        self.server.send_event("mks_configurator:profile_saved", {"profile_id": saved["profile_id"]})
        return saved

    async def _handle_delete(self, web_request) -> dict:
        profile_id = web_request.get_str("profile_id")
        ok = self.store.delete(profile_id)
        if not ok:
            raise self.server.error(f"perfil '{profile_id}' no existe", 404)
        return {"deleted": profile_id}

    async def _handle_render(self, web_request) -> dict:
        profile_id = web_request.get_str("profile_id")
        profile = self.store.get(profile_id)
        if profile is None:
            raise self.server.error(f"perfil '{profile_id}' no existe", 404)
        try:
            rendered = render_templates(self.paths, profile)
        except (ValueError, UndefinedError) as exc:
            raise self.server.error(f"perfil incompleto para renderizar: {exc}", 400)
        return {"files": rendered}

    async def _handle_apply(self, web_request) -> dict:
        profile_id = web_request.get_str("profile_id")
        do_restart = web_request.get_boolean("restart", False)
        profile = self.store.get(profile_id)
        if profile is None:
            raise self.server.error(f"perfil '{profile_id}' no existe", 404)

        try:
            rendered = render_templates(self.paths, profile)
        except (ValueError, UndefinedError) as exc:
            raise self.server.error(f"perfil incompleto para renderizar: {exc}", 400)

        written = write_rendered(self.paths, profile_id, rendered)
        backup = ensure_include_in_printer_cfg(self.paths, profile_id)

        result: dict[str, Any] = {
            "profile_id": profile_id,
            "files_written": [str(p) for p in written],
            "printer_cfg_backup": str(backup) if backup else None,
            "restarted": False,
        }

        if do_restart:
            klippy_apis = self.server.lookup_component("klippy_apis")
            await klippy_apis.run_gcode("RESTART")
            result["restarted"] = True

        self.server.send_event("mks_configurator:profile_applied", result)
        return result

    async def _handle_template_sync(self, web_request) -> dict:
        repo = self.paths.repo_path
        if not (repo / ".git").exists():
            raise self.server.error(
                f"{repo} no es un checkout git valido; ejecuta install.sh o clona manualmente", 400
            )
        fetch = run_git(repo, ["fetch", "--depth", "50", "origin"])
        if fetch.returncode != 0:
            raise self.server.error(f"git fetch fallo: {fetch.stderr.strip()}", 500)
        pull = run_git(repo, ["pull", "--ff-only"])
        if pull.returncode != 0:
            raise self.server.error(f"git pull fallo (posible divergencia local): {pull.stderr.strip()}", 500)
        status = await self._handle_template_status(web_request)
        self.server.send_event("mks_configurator:templates_synced", status)
        return status

    async def _handle_template_status(self, web_request) -> dict:
        repo = self.paths.repo_path
        if not (repo / ".git").exists():
            return {"cloned": False, "path": str(repo)}
        commit = run_git(repo, ["rev-parse", "--short", "HEAD"])
        branch = run_git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
        return {
            "cloned": True,
            "path": str(repo),
            "commit": commit.stdout.strip(),
            "branch": branch.stdout.strip(),
        }


def load_component(config):
    return MksConfigurator(config)
