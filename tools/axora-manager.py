#!/usr/bin/env python3
"""Professional local GTK manager for Axora production operations."""

import re
import csv
import shlex
import secrets
import string
import subprocess
import threading
from datetime import datetime
import os
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk


ROOT = Path("/srv/axora")
PUBLIC_URL = "https://axora.management"
ENV_FILES = {
    "Deploy environment": "/etc/axora-production/deploy.env",
    "Runtime environment": "/etc/axora-production/runtime.env",
}
EVENT_FILTERS = [
    "All events",
    "Deploy",
    "Deploy started",
    "Deploy ended",
    "Image Pull failed",
    "Failed",
]
SENSITIVE_ENV_KEYS = (
    "token",
    "secret",
    "password",
    "pass",
    "key",
    "cert",
    "dsn",
    "uri",
    "credential",
    "auth",
)
ROLE_LABELS = {
    "ADMIN": "Company Administrator",
    "BRANCH_ADMIN": "Branch Administrator",
    "APPROVER": "Approver (HR/CEO)",
    "REQUESTER": "Requester",
    "FINANCE": "Finance",
    "VIEWER": "Viewer",
    "OPERATIONS": "Operations",
    "IT_SUPPORT": "Technical Support",
}


def _safe_short(value, limit=10):
    if not value:
        return "—"
    value = str(value)
    return value if len(value) <= limit else f"{value[:limit]}…"


class Manager(Gtk.Window):
    def __init__(self):
        super().__init__(title="Axora Production Manager")
        self.set_default_size(1460, 900)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.connect("destroy", Gtk.main_quit)

        self._busy = False
        self._last_journal = ""
        self._release_index = {}
        self._db = None
        self._users = []
        self._user_index = {}
        self._user_tree = None
        self._user_selected_id = ""
        self._user_role_filter = None
        self._user_company_filter = None
        self._user_status_filter = "All status"
        self._users_search = None
        self._user_company_dropdown = None
        self._user_role_dropdown = None
        self._user_status_dropdown = None
        self._refresh_users_button = None
        self._user_create_btn = None
        self._user_activate_btn = None
        self._user_delete_btn = None
        self._user_reset_btn = None
        self._user_identity = None
        self._user_scope = None
        self._user_meta = None
        self._users_refresh_running = False
        self._users_refresh_pending = False
        self._users_refresh_source = 0
        self._user_company_filter_signal = 0

        self._css()
        self._build_ui()
        self._db = self._build_db_context()

        self.write("Ready. This manager operates the local production services only.")
        self.refresh()
        self._refresh_users()
        GLib.timeout_add_seconds(15, self.refresh)

    def _css(self):
        provider = Gtk.CssProvider()
        provider.load_from_data(b"""
        @define-color panel #ffffff;
        @define-color ok #16a34a;
        @define-color bad #dc2626;
        window {
          background: #eef2ff;
          font-family: "Noto Sans", "Ubuntu", "Arial", sans-serif;
          color: #0f172a;
        }

        .topbar {
          background: #0f172a;
          color: white;
          padding: 16px 20px;
        }

        .brand { font-size: 18px; font-weight: 700; color: white; }
        .brand-sub { color: #cbd5e1; font-size: 12px; }

        .panel {
          background: @panel;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
        }

        .side-panel {
          background: #0f172a;
          border-right: 1px solid #1f2937;
          padding: 14px;
        }

        .side-title {
          color: #cbd5e1;
          font-weight: 700;
          letter-spacing: 0.2px;
          margin-bottom: 10px;
        }

        .nav-btn {
          background: transparent;
          border-radius: 10px;
          border: 1px solid transparent;
          color: #cbd5e1;
          padding: 10px 12px;
          font-weight: 600;
        }

        .nav-btn:hover {
          border-color: #334155;
          background: rgba(148, 163, 184, 0.14);
          color: white;
        }

        .nav-btn.active {
          background: #334155;
          color: white;
          border-color: #475569;
        }

        .stack-content { padding: 14px; }

        .metric {
          background: white;
          border-radius: 12px;
          padding: 14px 16px;
          border: 1px solid #e2e8f0;
        }

        .metric-label {
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.3px;
        }

        .metric-value {
          color: #0f172a;
          font-size: 20px;
          font-weight: 700;
          margin-top: 6px;
        }

        .metric-ok { color: @ok; font-weight: 700; }
        .metric-bad { color: @bad; font-weight: 700; }

        .section-title {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 8px;
        }

        .pill {
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 11px;
          font-weight: 700;
          color: white;
        }

        .pill-ok { background: @ok; }
        .pill-warn { background: @warn; }
        .pill-bad { background: @bad; }

        .btn {
          padding: 10px 14px;
          border-radius: 9px;
          font-weight: 600;
        }

        button.btn.accent { background: #2563eb; color: #ffffff; }
        button.btn.warn { background: #f59e0b; color: #111827; }
        button.btn.danger { background: #dc2626; color: #ffffff; }
        button.btn.subtle {
          background: #e2e8f0;
          color: #0f172a;
        }

        frame { border-radius: 12px; }
        treeview { font-family: "JetBrains Mono", "Courier New", monospace; }
        textview { font-family: "JetBrains Mono", "Courier New", monospace; }
        """)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        )

    def _build_ui(self):
        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.add(outer)

        outer.pack_start(self._build_topbar(), False, False, 0)
        body = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=0)
        outer.pack_start(body, True, True, 0)

        body.pack_start(self._build_sidebar(), False, False, 0)
        body.pack_start(self._build_stack(), True, True, 0)

    def _build_db_context(self):
        context = {
            "db_container": self._find_container("db") or "axora-db-1",
            "app_container": self._find_container("app"),
            "db_name": "axora",
            "db_user": "axora_app",
            "db_host": "127.0.0.1",
            "db_port": "5432",
            "db_password_file": "/run/secrets/axora_app_password",
            "roles": [],
        }
        app_container = context["app_container"]
        if app_container:
            env_result = self._run_cmd(
                ["docker", "inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", app_container],
                cwd=ROOT,
                timeout=8,
            )
            if env_result.get("ok", False):
                env = {}
                for line in env_result["out"].splitlines():
                    if "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    env[key.strip()] = value.strip()
                context["db_name"] = env.get("DB_NAME", context["db_name"])
                context["db_user"] = env.get("DB_USER", context["db_user"])
                context["db_host"] = env.get("DB_HOST", context["db_host"])
                context["db_port"] = env.get("DB_PORT", context["db_port"])
                context["db_password_file"] = env.get("DB_PASSWORD_FILE", context["db_password_file"])
        return context

    def _find_container(self, service):
        found = self._run_cmd(
            ["docker", "ps", "--filter", f"label=com.docker.compose.service={service}", "--format", "{{.Names}}"],
            cwd=ROOT,
            timeout=8,
        )
        if not found.get("ok", False):
            return None
        names = [line.strip() for line in found["out"].splitlines() if line.strip()]
        return names[0] if names else None

    @staticmethod
    def _run_cmd(args, cwd=ROOT, timeout=20):
        try:
            process = subprocess.run(
                args,
                cwd=str(cwd),
                text=True,
                capture_output=True,
                timeout=timeout,
                check=False,
            )
            return {
                "ok": process.returncode == 0,
                "code": process.returncode,
                "out": (process.stdout or "").strip(),
                "err": (process.stderr or "").strip(),
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "code": 124, "out": "", "err": f"Command timeout after {timeout}s"}
        except Exception as exc:
            return {"ok": False, "code": 1, "out": "", "err": str(exc)}

    def _run_psql(self, command, *, timeout=20):
        db = self._db or {}
        container = db.get("db_container")
        if not container:
            return {"ok": False, "out": "", "err": "No PostgreSQL container detected."}

        # DB_PASSWORD_FILE is mounted in the DB container in this deployment.
        sql = command.replace("\"", "\\\"")
        sh_cmd = (
            f"PGPASSWORD=$(cat {shlex.quote(db.get('db_password_file', '/run/secrets/axora_app_password'))}) "
            f"psql -h 127.0.0.1 -p {shlex.quote(db.get('db_port', '5432'))} "
            f"-U {shlex.quote(db.get('db_user', 'axora_app'))} -d {shlex.quote(db.get('db_name', 'axora'))} "
            f"-t -A -F \"|\" -v ON_ERROR_STOP=1 -c \"{sql}\""
        )
        return self._run_cmd(["docker", "exec", container, "sh", "-lc", sh_cmd], timeout=timeout, cwd=ROOT)

    @staticmethod
    def _normalize_text(value):
        return "" if value in (None, "\\N") else str(value)

    @staticmethod
    def _safe_bool(value):
        return str(value).lower() in {"t", "true", "1"}

    def _build_topbar(self):
        topbar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        topbar.get_style_context().add_class("topbar")

        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
        title = Gtk.Label(label="Axora Deployment Manager", xalign=0)
        title.get_style_context().add_class("brand")
        left.pack_start(title, False, False, 0)
        sub = Gtk.Label(label="Production deployment control · local-first architecture", xalign=0)
        sub.get_style_context().add_class("brand-sub")
        left.pack_start(sub, False, False, 0)
        topbar.pack_start(left, True, True, 0)

        self.status_pill = Gtk.Label(label="Checking…")
        self.tunnel_pill = Gtk.Label(label="Cloudflare: Checking")
        self.status_pill.get_style_context().add_class("pill")
        self.tunnel_pill.get_style_context().add_class("pill")
        self.status_pill.get_style_context().add_class("pill-ok")
        self.tunnel_pill.get_style_context().add_class("pill-warn")
        topbar.pack_end(self.tunnel_pill, False, False, 0)
        topbar.pack_end(self.status_pill, False, False, 0)
        return topbar

    def _build_sidebar(self):
        side = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        side.set_size_request(220, -1)
        side.get_style_context().add_class("side-panel")

        title = Gtk.Label(label="CONTROL", xalign=0)
        title.get_style_context().add_class("side-title")
        side.pack_start(title, False, False, 0)

        buttons = [
            ("Dashboard", "dashboard"),
            ("Deployments", "deployments"),
            ("Events", "events"),
            ("Settings", "settings"),
            ("Users", "users"),
            ("Activity", "activity"),
        ]
        self._nav = {}
        for label, name in buttons:
            button = Gtk.Button(label=label)
            button.get_style_context().add_class("nav-btn")
            button.connect("clicked", self._on_nav, name)
            side.pack_start(button, False, False, 0)
            self._nav[name] = button

        sep = Gtk.Separator(orientation=Gtk.Orientation.HORIZONTAL)
        side.pack_start(sep, False, False, 4)

        quick_title = Gtk.Label(label="QUICK ACTIONS", xalign=0)
        quick_title.get_style_context().add_class("side-title")
        side.pack_start(quick_title, False, False, 0)

        open_public = Gtk.Button(label="Open Production Site")
        open_public.connect("clicked", lambda *_: self._open_url(PUBLIC_URL))
        open_public.get_style_context().add_class("nav-btn")
        side.pack_start(open_public, False, False, 0)

        side.pack_end(Gtk.Label(label="v. local", xalign=0), False, False, 2)
        self._set_active_nav("dashboard")
        return side

    def _open_url(self, url):
        def _launch_with_env(cmd, args, env=None):
            environment = os.environ.copy()
            if env:
                environment.update(env)
            subprocess.Popen([cmd] + args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=environment)

        candidates = [
            # Explicit Brave invocations (most reliable on this machine).
            (Path("/snap/bin/brave"), ["--new-window", url], {"CHROME_DEVEL_SANDBOX": "/snap/brave/current/opt/brave.com/brave/chrome-sandbox"}),
            (Path("/usr/bin/brave-browser"), [url], {"CHROME_DEVEL_SANDBOX": "/snap/brave/current/opt/brave.com/brave/chrome-sandbox"}),
            (Path("/home/ashraf/.local/bin/brave-browser"), [url], {"CHROME_DEVEL_SANDBOX": "/snap/brave/current/opt/brave.com/brave/chrome-sandbox"}),
            # Fallback through xdg-open stack.
            Path("/usr/bin/xdg-open"),
            Path("/snap/bin/brave"),
            Path("/usr/bin/brave"),
            Path("/usr/bin/brave-browser"),
            Path("/usr/local/bin/brave"),
            Path("/usr/local/bin/brave-browser"),
            Path("/home/ashraf/.local/bin/xdg-open"),
            Path("/home/ashraf/.local/bin/brave-browser"),
        ]

        if "://" not in url:
            url = f"https://{url}"

        def _launch(cmd):
            subprocess.Popen([str(cmd), url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        for candidate in candidates:
            if isinstance(candidate, tuple):
                candidate_path, candidate_args, candidate_env = candidate
                if not candidate_path.exists():
                    continue
                try:
                    _launch_with_env(str(candidate_path), candidate_args, candidate_env)
                    self.write(f"Opening production site with {candidate_path.name}…")
                    return
                except Exception as exc:
                    self.write(f"Unable to launch {candidate_path}: {exc}")
                continue

            if not candidate.exists():
                continue
            try:
                _launch(str(candidate))
                self.write(f"Opening production site with {candidate.name}…")
                return
            except Exception as exc:
                self.write(f"Unable to launch {candidate}: {exc}")

        try:
            subprocess.Popen(["/usr/bin/xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.write("Opening production site with /usr/bin/xdg-open…")
            return
        except Exception as exc:
            self.write(f"Unable to open production site: {exc}")

    def _build_stack(self):
        self.stack = Gtk.Stack()
        self.stack.set_hexpand(True)
        self.stack.set_vexpand(True)
        self.stack.set_transition_type(Gtk.StackTransitionType.SLIDE_LEFT_RIGHT)
        self.stack.set_transition_duration(120)
        self.stack.get_style_context().add_class("stack-content")

        self.stack.add_named(self._build_dashboard_page(), "dashboard")
        self.stack.add_named(self._build_deploy_page(), "deployments")
        self.stack.add_named(self._build_events_page(), "events")
        self.stack.add_named(self._build_settings_page(), "settings")
        self.stack.add_named(self._build_users_page(), "users")
        self.stack.add_named(self._build_activity_page(), "activity")
        self.stack.show_all()
        return self.stack

    def _container_panel(self, title):
        frame = Gtk.Frame(label=title)
        frame.get_style_context().add_class("panel")
        inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        inner.set_margin_top(12)
        inner.set_margin_bottom(12)
        inner.set_margin_start(12)
        inner.set_margin_end(12)
        frame.add(inner)
        return frame, inner

    def _build_dashboard_page(self):
        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        page.set_border_width(12)

        metric_frame = Gtk.Frame()
        metric_frame.get_style_context().add_class("panel")
        metric_grid = Gtk.Grid(column_spacing=12, row_spacing=12)
        metric_grid.set_row_spacing(12)
        metric_grid.set_column_spacing(12)
        metric_grid.set_margin_top(10)
        metric_grid.set_margin_bottom(10)
        metric_grid.set_margin_start(10)
        metric_grid.set_margin_end(10)
        metric_frame.add(metric_grid)

        self.sha = self._metric_card("Current release")
        self.service = self._metric_card("Deployment worker")
        self.public = self._metric_card("Public endpoint")
        self.version = self._metric_card("Release state")
        self.timer = self._metric_card("Auto-deploy timer")

        metric_grid.attach(self.sha, 0, 0, 1, 1)
        metric_grid.attach(self.service, 1, 0, 1, 1)
        metric_grid.attach(self.public, 2, 0, 1, 1)
        metric_grid.attach(self.version, 3, 0, 1, 1)
        metric_grid.attach(self.timer, 4, 0, 1, 1)
        page.pack_start(metric_frame, False, False, 0)

        actions_card, actions_body = self._container_panel("Quick release actions")
        actions_row = Gtk.Box(spacing=10)
        actions_card_vbox = actions_body
        self.deploy = self._button("Deploy approved main", "accent", self.deploy_clicked)
        self.rollback = self._button("Rollback latest", "danger", self.rollback_clicked)
        actions_row.pack_start(self.deploy, False, False, 0)
        actions_row.pack_start(self.rollback, False, False, 0)
        actions_row.pack_start(self._button("Refresh", "subtle", self.refresh), False, False, 0)
        actions_card_vbox.pack_start(actions_row, False, False, 0)

        desc = Gtk.Label(xalign=0)
        desc.set_text(
            "Use this page to deploy from trusted main, follow event telemetry, and perform rollback operations."
        )
        actions_card_vbox.pack_start(desc, False, False, 2)
        page.pack_start(actions_card, False, False, 0)

        quick_events, quick_events_body = self._container_panel("Latest deploy events")
        self.dashboard_events = self._build_event_table(rows=8)
        quick_events_body.pack_start(self.dashboard_events, True, True, 0)
        quick_events_body.pack_start(self._button("Open full Events", "subtle", self._goto_events), False, False, 0)
        page.pack_start(quick_events, True, True, 0)
        return page

    def _build_deploy_page(self):
        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        page.set_border_width(12)

        frame, body = self._container_panel("Version control")
        row = Gtk.Box(spacing=10)
        row.pack_start(Gtk.Label(label="Rollback version", xalign=0), False, False, 0)
        self.releases = Gtk.ComboBoxText()
        self.releases.set_hexpand(True)
        row.pack_start(self.releases, True, True, 0)
        row.pack_end(self._button("Rollback selected", "danger", self.rollback_selected), False, False, 0)
        body.pack_start(row, False, False, 0)

        history_box = Gtk.ScrolledWindow()
        history_box.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        history_box.set_size_request(-1, 255)
        self.version_log = Gtk.TextView(editable=False)
        self.version_log.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        history_box.add(self.version_log)
        body.pack_start(history_box, True, True, 0)
        page.pack_start(frame, True, True, 0)

        actions = Gtk.Box(spacing=10)
        self.rollback = self._button("Rollback latest", "warn", self.rollback_clicked)
        self.deploy = self._button("Run deployment check", "accent", self.deploy_clicked)
        actions.pack_start(self.deploy, False, False, 0)
        actions.pack_start(self.rollback, False, False, 0)
        actions.pack_end(self._button("Manual refresh", "subtle", self.refresh), False, False, 0)
        page.pack_start(actions, False, False, 0)
        return page

    def _build_events_page(self):
        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        page.set_border_width(12)

        frame, body = self._container_panel("Events (render-style)")
        filters = Gtk.Box(spacing=10)
        filters.pack_start(Gtk.Label(label="Filter"), False, False, 0)
        self.event_filter = Gtk.ComboBoxText()
        for item in EVENT_FILTERS:
            self.event_filter.append_text(item)
        self.event_filter.set_active(0)
        self.event_filter.connect("changed", self.refresh)
        filters.pack_start(self.event_filter, False, False, 0)
        filters.pack_start(Gtk.Label(label="Search", xalign=0), False, False, 8)
        self.event_search = Gtk.Entry()
        self.event_search.set_placeholder_text("Filter message text…")
        self.event_search.connect("changed", self.refresh)
        filters.pack_start(self.event_search, True, True, 0)
        actions = Gtk.Box(spacing=10)
        actions.pack_start(self._button("Refresh logs", "subtle", self.refresh), False, False, 0)
        actions.pack_end(self._button("Open live terminal logs", "subtle", self.open_deploy_terminal_logs), False, False, 0)

        self.main_events = self._build_event_table(rows=180)
        events_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        events_box.pack_start(filters, False, False, 0)
        events_box.pack_start(self.main_events, True, True, 0)
        events_box.pack_start(actions, False, False, 0)

        body.pack_start(events_box, True, True, 0)
        page.pack_start(frame, True, True, 0)
        return page

    def _build_settings_page(self):
        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        page.set_border_width(12)

        frame, body = self._container_panel("Production settings")
        body.pack_start(self._button("Show env files", "subtle", self.settings_clicked), False, False, 0)
        body.pack_start(Gtk.Label(label="Read-only snapshot from /etc/axora-production/*.env"), False, False, 4)
        note = Gtk.Label(xalign=0)
        note.set_text("Passwords are one-way hashes and cannot be displayed. Use secure reset workflow for credential rotation.")
        body.pack_start(note, False, False, 8)
        page.pack_start(frame, False, False, 0)

        tools_frame, tools_body = self._container_panel("Release & logs")
        tools_body.pack_start(self._button("Open release manifest", "subtle", self.open_release_manifest), False, False, 0)
        tools_body.pack_start(self._button("Open deploy logs in terminal", "subtle", self.open_deploy_terminal_logs), False, False, 0)
        page.pack_start(tools_frame, False, False, 0)
        return page

    def _build_users_page(self):
        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        page.set_border_width(12)

        frame, body = self._container_panel("Users administration (Render-style)")
        filters = Gtk.Box(spacing=10)
        self._user_search = Gtk.Entry()
        self._user_search.set_placeholder_text("Search name, email or role…")
        self._user_search.connect("changed", self._queue_user_refresh)

        self._user_status_dropdown = Gtk.ComboBoxText()
        for label in ("All status", "Active", "Inactive"):
            self._user_status_dropdown.append_text(label)
        self._user_status_dropdown.set_active(0)
        self._user_status_dropdown.connect("changed", self._queue_user_refresh)

        self._user_role_dropdown = Gtk.ComboBoxText()
        self._user_role_dropdown.append_text("All roles")
        for role in ROLE_LABELS:
            self._user_role_dropdown.append_text(role)
        self._user_role_dropdown.set_active(0)
        self._user_role_dropdown.connect("changed", self._queue_user_refresh)

        self._user_company_dropdown = Gtk.ComboBoxText()
        self._user_company_dropdown.append_text("All companies")
        self._user_company_filter_signal = self._user_company_dropdown.connect("changed", self._queue_user_refresh)

        self._refresh_users_button = self._button("Refresh users", "subtle", self._refresh_users)
        self._user_create_btn = self._button("Create user", "accent", self._open_create_user_dialog)

        filters.pack_start(Gtk.Label(label="Search", xalign=0), False, False, 0)
        filters.pack_start(self._user_search, True, True, 0)
        filters.pack_start(Gtk.Label(label="Status", xalign=0), False, False, 4)
        filters.pack_start(self._user_status_dropdown, False, False, 0)
        filters.pack_start(Gtk.Label(label="Role", xalign=0), False, False, 4)
        filters.pack_start(self._user_role_dropdown, False, False, 0)
        filters.pack_start(Gtk.Label(label="Company", xalign=0), False, False, 4)
        filters.pack_start(self._user_company_dropdown, False, False, 0)
        filters.pack_start(self._refresh_users_button, False, False, 0)
        filters.pack_start(self._user_create_btn, False, False, 0)
        body.pack_start(filters, False, False, 0)

        model = Gtk.ListStore(str, str, str, str, str, str, str, str, str)
        model.set_sort_column_id(1, Gtk.SortType.ASCENDING)
        self._user_tree = Gtk.TreeView(model=model)
        self._user_tree.set_headers_visible(True)
        self._user_tree.set_grid_lines(Gtk.TreeViewGridLines.HORIZONTAL)

        for idx, title, expand in [
            (1, "Name", False),
            (2, "Email", True),
            (3, "Role", False),
            (4, "Company", False),
            (5, "Scope", False),
            (6, "Status", False),
            (7, "Last login", False),
            (8, "Created", True),
        ]:
            renderer = Gtk.CellRendererText()
            column = Gtk.TreeViewColumn(title, renderer, text=idx)
            column.set_expand(expand)
            column.set_resizable(True)
            if idx == 2:
                column.set_min_width(170)
            self._user_tree.append_column(column)
        self._user_tree.set_rules_hint(True)
        sel = self._user_tree.get_selection()
        sel.connect("changed", self._user_row_selected)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        scroll.add(self._user_tree)
        body.pack_start(scroll, True, True, 0)

        action_box = Gtk.Box(spacing=10)
        self._user_identity = Gtk.Label(label="No user selected", xalign=0)
        self._user_scope = Gtk.Label(label="", xalign=0)
        self._user_identity.get_style_context().add_class("section-title")
        self._user_meta = Gtk.Label(label="", xalign=0)
        self._user_identity.set_line_wrap(True)
        self._user_meta.set_line_wrap(True)

        self._user_activate_btn = self._button("Deactivate user", "warn", self._toggle_selected_user_active)
        self._user_activate_btn.set_sensitive(False)
        self._user_reset_btn = self._button("Reset password", "subtle", self._reset_selected_password)
        self._user_reset_btn.set_sensitive(False)
        self._user_delete_btn = self._button("Delete user", "danger", self._delete_selected_user)
        self._user_delete_btn.set_sensitive(False)

        action_box.pack_start(self._user_identity, True, True, 0)
        action_box.pack_start(self._user_scope, False, False, 10)
        action_box.pack_start(self._user_activate_btn, False, False, 0)
        action_box.pack_start(self._user_reset_btn, False, False, 0)
        action_box.pack_start(self._user_delete_btn, False, False, 0)

        meta_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        meta_box.pack_start(self._user_meta, False, False, 0)
        action_box.pack_start(meta_box, True, True, 0)

        body.pack_start(action_box, False, False, 0)
        page.pack_start(frame, True, True, 0)
        return page

    def _build_users_filters(self):
        self._user_status_filter = self._user_status_dropdown.get_active_text() or "All status"
        self._user_role_filter = self._user_role_dropdown.get_active_text() or "All roles"
        active_company = self._user_company_dropdown.get_active_text() or "All companies"
        if active_company == "All companies" or " · " not in active_company:
            self._user_company_filter = ""
        else:
            self._user_company_filter = active_company.rsplit(" · ", 1)[-1]

    def _parse_user_csv_rows(self, raw):
        rows = []
        if not raw:
            return rows
        reader = csv.reader(raw.splitlines(), delimiter="|")
        for row in reader:
            if not row:
                continue
            rows.append([self._normalize_text(cell) for cell in row])
        return rows

    def _load_users(self):
        return self._run_psql(
            "SELECT u.id::text,u.display_name,u.email,r.role_key,u.active::text,u.is_owner::text,"
            "COALESCE(c.id::text,''),COALESCE(c.name,''),"
            "COALESCE(b.id::text,''),COALESCE(b.name,''),"
            "COALESCE(to_char(u.last_login_at, 'YYYY-MM-DD HH24:MI'),''),"
            "COALESCE(to_char(u.created_at, 'YYYY-MM-DD'),'') "
            "FROM users u JOIN roles r ON r.id=u.role_id "
            "LEFT JOIN companies c ON c.id=u.company_id "
            "LEFT JOIN branches b ON b.id=u.branch_id "
            "ORDER BY u.display_name ASC"
        )

    def _load_companies(self):
        return self._run_psql(
            "SELECT id::text,name FROM companies WHERE active=true ORDER BY name ASC"
        )

    def _load_branches(self):
        return self._run_psql(
            "SELECT b.id::text,b.name,c.name FROM branches b "
            "LEFT JOIN companies c ON c.id=b.company_id WHERE b.active=true ORDER BY c.name ASC,b.name ASC"
        )

    def _user_dict(self, row):
        role_key = row[3]
        # row mapping: id, name, email, role, active, is_owner, company_id, company, branch_id, branch, last_login, created
        return {
            "id": row[0],
            "name": row[1],
            "email": row[2],
            "role": role_key,
            "active": self._safe_bool(row[4]),
            "isOwner": self._safe_bool(row[5]),
            "companyId": self._normalize_text(row[6]) if len(row) > 6 else "",
            "company": self._normalize_text(row[7]) if len(row) > 7 else "",
            "branchId": self._normalize_text(row[8]) if len(row) > 8 else "",
            "branch": self._normalize_text(row[9]) if len(row) > 9 else "",
            "lastLogin": self._normalize_text(row[10]) if len(row) > 10 else "",
            "created": self._normalize_text(row[11]) if len(row) > 11 else "",
            "roleLabel": ROLE_LABELS.get(role_key, role_key),
            "scope": self._normalize_text(row[9]) if len(row) > 9 else "Company-wide",
        }

    def _queue_user_refresh(self, *_args):
        if self._users_refresh_source:
            GLib.source_remove(self._users_refresh_source)
            self._users_refresh_source = 0

        self._users_refresh_source = GLib.timeout_add(350, self._run_user_refresh)

    def _run_user_refresh(self):
        self._users_refresh_source = 0
        self._refresh_users()
        return False

    def _refresh_users(self, *_args):
        if self._users_refresh_running:
            self._users_refresh_pending = True
            return

        self._users_refresh_running = True
        self._users_refresh_pending = False

        def worker():
            GLib.idle_add(self._set_users_busy, True)
            try:
                data = self._load_users()
                company_data = self._load_companies()
                if not data.get("ok", False):
                    GLib.idle_add(
                        self.write,
                        f"Users query failed: {data.get('err') or data.get('out') or 'unknown'}",
                    )
                    return
                rows = self._parse_user_csv_rows(data["out"])
                users = [self._user_dict(row) for row in rows]

                companies = []
                if company_data.get("ok", False):
                    companies = self._parse_user_csv_rows(company_data["out"])

                self._users = users
                self._user_index = {item["id"]: item for item in users}

                GLib.idle_add(self._refresh_user_filters, companies)
                GLib.idle_add(self._draw_users)
            except Exception as exc:
                GLib.idle_add(self.write, f"Users refresh failed: {exc}")
            finally:
                self._users_refresh_running = False
                if self._users_refresh_pending:
                    self._users_refresh_pending = False
                    GLib.idle_add(self._run_user_refresh)
                GLib.idle_add(self._set_users_busy, False)

        threading.Thread(target=worker, daemon=True).start()

    def _set_users_busy(self, enabled):
        if self._refresh_users_button:
            self._refresh_users_button.set_sensitive(not enabled)
        if self._user_create_btn:
            self._user_create_btn.set_sensitive(not enabled)
        self._build_users_filters()
        self._user_tree.set_sensitive(not enabled)

    def _refresh_user_filters(self, companies):
        if self._user_company_dropdown is None:
            return

        active = self._user_company_dropdown.get_active_text()
        signal = self._user_company_filter_signal
        if signal:
            self._user_company_dropdown.handler_block(signal)
        try:
            self._user_company_dropdown.remove_all()
            self._user_company_dropdown.append_text("All companies")
            for row in companies:
                if not row or not row[0]:
                    continue
                self._user_company_dropdown.append_text(f"{row[1]} · {row[0]}")
            if active and any(option == active for option in self._user_company_filter_options()):
                try:
                    self._user_company_dropdown.set_active_text(active)
                except AttributeError:
                    for i, option in enumerate(self._user_company_filter_options()):
                        if option == active:
                            self._user_company_dropdown.set_active(i)
                            break
            else:
                self._user_company_dropdown.set_active(0)
        finally:
            if signal:
                self._user_company_dropdown.handler_unblock(signal)

    def _user_company_filter_options(self):
        if not self._user_company_dropdown:
            return []
        model = self._user_company_dropdown.get_model()
        return [str(row[0]) for row in model]

    def _draw_users(self):
        if self._user_tree is None:
            return
        if not hasattr(self._user_tree, "get_model"):
            return
        model = self._user_tree.get_model()
        model.clear()

        self._build_users_filters()
        search = (self._user_search.get_text() if self._user_search else "").strip().lower()
        status = self._user_status_filter
        role = self._user_role_filter
        company = self._user_company_filter

        filtered = []
        for user in self._users:
            if search:
                target = " ".join(
                    [
                        user["name"],
                        user["email"],
                        user["role"],
                        user["roleLabel"],
                        user["company"],
                        user["branch"],
                    ]
                ).lower()
                if search not in target:
                    continue
            if role != "All roles" and user["role"] != role:
                continue
            if status == "Active" and not user["active"]:
                continue
            if status == "Inactive" and user["active"]:
                continue
            if company and user["companyId"] != company:
                continue
            filtered.append(user)

        for user in filtered:
            row = [
                self._normalize_text(user["id"]),
                user["name"],
                user["email"],
                user["roleLabel"],
                user["company"] or "Axora platform",
                self._safe_company_scope(user),
                "Active" if user["active"] else "Inactive",
                user["lastLogin"] or "never",
                user["created"] or "—",
            ]
            model.append(row)

        self._user_identity.set_text("No user selected" if filtered else "No users match your filters.")
        if self._user_scope:
            self._user_scope.set_text("Showing {} users".format(len(filtered)))

        if self._user_meta:
            self._user_meta.set_text(
                "Password: not retrievable (hashed). Use “Reset password” to set a new one."
            )

    def _safe_company_scope(self, user):
        if user.get("isOwner"):
            return "Platform owner"
        return user.get("branch") or "Company-wide"

    def _user_row_selected(self, selection):
        model, tree_iter = selection.get_selected()
        if not tree_iter:
            self._user_selected_id = ""
            self._user_identity.set_text("No user selected")
            self._user_scope.set_text("")
            self._user_meta.set_text("")
            self._user_activate_btn.set_sensitive(False)
            self._user_reset_btn.set_sensitive(False)
            self._user_delete_btn.set_sensitive(False)
            return
        user_id = model[tree_iter][0]
        self._user_selected_id = user_id
        user = self._user_index.get(user_id)
        if not user:
            return

        self._user_identity.set_text(f"{user['name']} · {user['email']}")
        self._user_scope.set_text(f"{user['roleLabel']} · {user.get('company', 'Axora platform')} · {user['scope']}")
        self._user_meta.set_text(
            f"User ID: {user_id}\nCreated: {user.get('created') or '—'} · Last login: {user.get('lastLogin') or 'never'}"
        )
        self._set_selection_controls(user)

    def _set_selection_controls(self, user):
        if user.get("isOwner"):
            self._user_activate_btn.set_sensitive(False)
            self._user_reset_btn.set_sensitive(False)
            self._user_delete_btn.set_sensitive(False)
            self._user_activate_btn.set_label("Owner protected")
            return

        self._user_activate_btn.set_sensitive(True)
        self._user_reset_btn.set_sensitive(True)
        self._user_delete_btn.set_sensitive(True)
        self._user_activate_btn.set_label("Deactivate user" if user["active"] else "Reactivate user")

    def _safe_dialog(self, title, text):
        dialog = Gtk.MessageDialog(
            self,
            Gtk.DialogFlags.MODAL,
            Gtk.MessageType.INFO,
            Gtk.ButtonsType.OK_CANCEL,
            title,
        )
        dialog.format_secondary_text(text)
        response = dialog.run()
        dialog.destroy()
        return response == Gtk.ResponseType.OK

    def _toggle_selected_user_active(self, _button):
        user = self._user_index.get(self._user_selected_id)
        if not user:
            self.write("Select a user first.")
            return

        action = "deactivate" if user["active"] else "reactivate"
        if not self._safe_dialog("Change user status", f"{action.title()} {user['email']}?"):
            return
        # keep logic to avoid removing last active company administrator
        validation = self._run_psql(
            "SELECT u.company_id::text, u.active::text, r.role_key "
            f"FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id = {self._pg_quote(user['id'])}"
        )
        if not validation.get("ok", False) or not validation["out"].strip():
            self.write("Cannot verify selected user state.")
            return
        row = self._parse_user_csv_rows(validation["out"])[0] if validation["out"].strip() else []
        company_id = row[0] if len(row) > 0 else ""
        role = row[2] if len(row) > 2 else "REQUESTER"
        if role == "ADMIN" and company_id and user["active"]:
            count = self._run_psql(
                "SELECT count(*)::text FROM users u JOIN roles r ON r.id=u.role_id "
                f"WHERE u.company_id={self._pg_quote(company_id)} AND u.active=true AND r.role_key='ADMIN';"
            )
            if count.get("ok", False):
                current = int(count["out"].strip() or "0")
                if current <= 1:
                    self.write("The last active company admin cannot be deactivated.")
                    return

        update = self._run_psql(
            "UPDATE users SET active="
            + ("true" if action == "reactivate" else "false")
            + " WHERE id="
            + self._pg_quote(user["id"])
        )
        if update.get("ok", False):
            self.write(f"User status updated: {action}d {user['email']}.")
            self._refresh_users()
        else:
            self.write(f"Unable to update user status: {update['err'] or update['out']}")

    def _delete_selected_user(self, _button):
        user = self._user_index.get(self._user_selected_id)
        if not user:
            self.write("Select a user first.")
            return
        if not self._safe_dialog("Delete user", f"Delete {user['email']} and remove access immediately?"):
            return
        if user["isOwner"]:
            self.write("The platform owner account cannot be deleted.")
            return

        if user["role"] == "ADMIN" and user.get("companyId"):
            count = self._run_psql(
                "SELECT count(*)::text FROM users u JOIN roles r ON r.id=u.role_id "
                f"WHERE u.company_id={self._pg_quote(user['companyId'])} AND u.active=true AND r.role_key='ADMIN';"
            )
            if count.get("ok", False):
                if int(count["out"].strip() or "0") <= 1:
                    self.write("The last company admin cannot be deleted.")
                    return

        tx = "BEGIN;"
        tx += f"UPDATE requests SET created_by=NULL WHERE created_by={self._pg_quote(user['id'])};"
        tx += f"UPDATE approvals SET reviewer_id=NULL WHERE reviewer_id={self._pg_quote(user['id'])};"
        tx += f"UPDATE payments SET recorded_by=NULL WHERE recorded_by={self._pg_quote(user['id'])};"
        tx += f"UPDATE attachments SET uploaded_by=NULL WHERE uploaded_by={self._pg_quote(user['id'])};"
        tx += f"UPDATE audit_logs SET actor_id=NULL WHERE actor_id={self._pg_quote(user['id'])};"
        tx += f"UPDATE product_images SET created_by=NULL WHERE created_by={self._pg_quote(user['id'])};"
        tx += f"DELETE FROM users WHERE id={self._pg_quote(user['id'])};"
        tx += "COMMIT;"
        result = self._run_psql(tx)
        if result.get("ok", False):
            self.write(f"Deleted user {user['email']}.")
            self._refresh_users()
        else:
            self.write(f"Delete failed: {result['err'] or result['out']}")

    def _reset_selected_password(self, _button):
        user = self._user_index.get(self._user_selected_id)
        if not user:
            self.write("Select a user first.")
            return

        dialog = Gtk.Dialog(title="Reset password", transient_for=self, flags=Gtk.DialogFlags.MODAL)
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        dialog.add_button("Set password", Gtk.ResponseType.OK)
        dialog.set_default_size(520, 180)
        body = dialog.get_content_area()
        body.set_border_width(12)
        body.pack_start(Gtk.Label(xalign=0, label=f"Set a new password for {user['email']}"), False, False, 0)
        password_entry = Gtk.Entry()
        password_entry.set_visibility(False)
        password_entry.set_invisible_char("•")
        password_entry.set_placeholder_text("New password (min 14)")
        body.pack_start(password_entry, False, False, 8)
        body.pack_start(self._button("Generate strong password", "subtle", lambda _button: self._fill_random_password(password_entry)), False, False, 0)
        body.show_all()
        response = dialog.run()
        password = password_entry.get_text().strip()
        dialog.destroy()
        if response != Gtk.ResponseType.OK:
            return
        if len(password) < 14:
            self.write("Password must be at least 14 characters.")
            return
        hash_result = self._hash_password(password)
        if not hash_result:
            self.write("Password hashing failed.")
            return
        update = self._run_psql(
            "UPDATE users SET password_hash = " + self._pg_quote(hash_result) + " WHERE id=" + self._pg_quote(user["id"])
        )
        if update.get("ok", False):
            self.write(f"Password updated for {user['email']}.")
        else:
            self.write(f"Password update failed: {update['err'] or update['out']}")

    def _fill_random_password(self, entry):
        chars = string.ascii_letters + string.digits + "!@#$%^&*()-_"
        generated = "".join(secrets.choice(chars) for _ in range(16))
        entry.set_text(generated)

    def _hash_password(self, password):
        result = self._run_cmd(
            ["node", "-e",
             "const {hash}=require('bcryptjs'); (async()=>{"
             "const h = await hash(process.argv[1],12); console.log(h);})();",
             password]
        )
        if not result.get("ok", False):
            return ""
        return result.get("out", "").strip()

    def _open_create_user_dialog(self, _button):
        dialog = Gtk.Dialog(title="Create user", transient_for=self, flags=Gtk.DialogFlags.MODAL)
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        dialog.add_button("Create", Gtk.ResponseType.OK)
        dialog.set_default_size(700, 520)
        body = dialog.get_content_area()
        body.set_border_width(12)

        grid = Gtk.Grid(column_spacing=12, row_spacing=10)
        grid.set_row_homogeneous(False)
        body.pack_start(grid, True, True, 0)

        email = Gtk.Entry()
        email.set_placeholder_text("user@company.local")
        display = Gtk.Entry()
        display.set_placeholder_text("Full name")
        password = Gtk.Entry()
        password.set_visibility(False)
        password.set_placeholder_text("Temporary password (min 14)")
        company = Gtk.ComboBoxText()
        company.append_text("Select company")
        company.set_active(0)
        branch = Gtk.ComboBoxText()
        branch.append_text("Company-wide user")
        branch.set_active(0)
        branch.set_sensitive(False)
        owner = Gtk.CheckButton(label="Platform owner (system-wide)")
        owner_note = Gtk.Label(xalign=0)
        owner_note.set_text("Owner users should be used sparingly.")

        role = Gtk.ComboBoxText()
        for role_key in ROLE_LABELS:
            role.append_text(role_key)
        role.set_active(0)

        company_result = self._run_psql("SELECT id::text,name FROM companies WHERE active=true ORDER BY name ASC")
        branch_result = self._run_psql(
            "SELECT b.id::text,b.name,COALESCE(c.id::text,'') "
            "FROM branches b LEFT JOIN companies c ON c.id=b.company_id "
            "WHERE b.active=true ORDER BY c.name ASC,b.name ASC"
        )

        company_rows = self._parse_user_csv_rows(company_result["out"]) if company_result.get("ok", False) else []
        branch_rows = self._parse_user_csv_rows(branch_result["out"]) if branch_result.get("ok", False) else []
        branches_by_company = {}
        for row in branch_rows:
            if len(row) < 3:
                continue
            branches_by_company.setdefault(row[2], []).append((row[0], row[1]))

        for row in company_rows:
            if len(row) < 2:
                continue
            company.append_text(f"{row[1]} · {row[0]}")

        def company_id():
            value = company.get_active_text() or ""
            if value == "Select company" or " · " not in value:
                return ""
            return value.rsplit(" · ", 1)[-1]

        def refresh_branches(*_):
            selected_company = company_id()
            branch.remove_all()
            branch.append_text("Company-wide user")
            if selected_company and selected_company in branches_by_company:
                for branch_id, branch_name in branches_by_company[selected_company]:
                    branch.append_text(f"{branch_name} · {branch_id}")
            branch.set_active(0)

        def branch_id():
            value = branch.get_active_text() or "Company-wide user"
            if value == "Company-wide user" or " · " not in value:
                return ""
            return value.rsplit(" · ", 1)[-1]

        def branch_required(selected_role):
            return selected_role in ("REQUESTER", "APPROVER", "BRANCH_ADMIN")

        def refresh_visibility(*_):
            selected_role = role.get_active_text() or "VIEWER"
            is_owner = owner.get_active()
            company.set_sensitive(not is_owner)
            if is_owner:
                company.set_active(0)
                branch.set_active(0)
                branch.set_sensitive(False)
                note.set_text("Owner users are system-scoped and are not tied to branches.")
                return

            role_needs_branch = branch_required(selected_role)
            if role_needs_branch:
                branch.set_sensitive(True)
                note.set_text(
                    "Requester/Approver/Branch Admin users require an active branch assignment."
                )
            else:
                branch.set_sensitive(False)
                branch.set_active(0)
                note.set_text("Company-wide roles are selected unless a specific branch is needed.")

            refresh_branches()
            if selected_role == "ADMIN":
                note.set_text("Admin users manage company scope.")

        role.connect("changed", refresh_visibility)
        owner.connect("toggled", refresh_visibility)
        company.connect("changed", lambda *_: refresh_visibility())

        grid.attach(Gtk.Label(label="Email", xalign=0), 0, 0, 1, 1)
        grid.attach(email, 1, 0, 1, 1)
        grid.attach(Gtk.Label(label="Display name", xalign=0), 0, 1, 1, 1)
        grid.attach(display, 1, 1, 1, 1)
        grid.attach(Gtk.Label(label="Role", xalign=0), 0, 2, 1, 1)
        grid.attach(role, 1, 2, 1, 1)
        grid.attach(Gtk.Label(label="Company", xalign=0), 0, 3, 1, 1)
        grid.attach(company, 1, 3, 1, 1)
        grid.attach(Gtk.Label(label="System owner", xalign=0), 0, 4, 1, 1)
        grid.attach(owner, 1, 4, 1, 1)
        grid.attach(Gtk.Label(label="Branch", xalign=0), 0, 5, 1, 1)
        grid.attach(branch, 1, 5, 1, 1)
        grid.attach(Gtk.Label(label="Password", xalign=0), 0, 6, 1, 1)
        grid.attach(password, 1, 6, 1, 1)
        grid.attach(owner_note, 1, 7, 1, 1)

        gen_btn = self._button("Generate password", "subtle", lambda *_: password.set_text(self._generate_password()))
        gen_wrapper = Gtk.Box(spacing=8)
        gen_wrapper.pack_start(gen_btn, False, False, 0)
        grid.attach(gen_wrapper, 1, 8, 1, 1)

        note = Gtk.Label(xalign=0)
        note.set_text("Branch users (Requester/Approver/Branch Admin) require an active branch id.")
        body.pack_start(note, False, False, 8)
        body.show_all()
        refresh_visibility()

        response = dialog.run()
        result = (
            email.get_text().strip(),
            display.get_text().strip(),
            role.get_active_text() or "VIEWER",
            company_id(),
            branch_id(),
            password.get_text().strip(),
            owner.get_active(),
        )
        dialog.destroy()

        if response != Gtk.ResponseType.OK:
            return

        email_value, display_value, selected_role, company_id, branch_id_value, password_value, is_owner_value = result
        if not email_value or "@" not in email_value:
            self.write("Invalid email.")
            return
        if not display_value:
            self.write("Display name required.")
            return
        if len(password_value) < 14:
            self.write("Password must be at least 14 characters.")
            return

        if not is_owner_value and not company_id:
            self.write("Company is required for this role.")
            return

        if selected_role in ("REQUESTER", "APPROVER", "BRANCH_ADMIN"):
            if not branch_id_value:
                self.write(f"{selected_role} users require a branch.")
                return
            branch_check = self._run_psql(
                "SELECT id::text FROM branches WHERE id="
                + self._pg_quote(branch_id_value)
                + " AND company_id="
                + self._pg_quote(company_id)
                + " AND active=true"
            )
            if not branch_check.get("ok", False) or not branch_check["out"].strip():
                self.write("Branch not found or not active.")
                return

        exists = self._run_psql(
            "SELECT 1 FROM users WHERE lower(email)=" + self._pg_quote(email_value.lower())
        )
        if exists.get("ok", False) and exists["out"].strip():
            self.write("Email already exists.")
            return

        password_hash = self._hash_password(password_value)
        if not password_hash:
            self.write("Could not hash password.")
            return

        company_sql = "NULL" if is_owner_value else self._pg_quote(company_id)
        branch_sql = self._pg_quote(branch_id_value) if branch_id_value else "NULL"

        statement = (
            "INSERT INTO users(email,display_name,password_hash,role_id,company_id,branch_id,is_owner) "
            f"VALUES ({self._pg_quote(email_value.lower())}, "
            f"{self._pg_quote(display_value)}, "
            f"{self._pg_quote(password_hash)}, "
            "(SELECT id FROM roles WHERE role_key="
            f"{self._pg_quote(selected_role)}), "
            f"{company_sql}, "
            f"{branch_sql}, "
            f"{'TRUE' if is_owner_value else 'FALSE'}) "
            "ON CONFLICT (lower(email)) DO UPDATE SET "
            "display_name=EXCLUDED.display_name, "
            "password_hash=EXCLUDED.password_hash, "
            "role_id=EXCLUDED.role_id, "
            "company_id=EXCLUDED.company_id, "
            "branch_id=EXCLUDED.branch_id"
        )
        create = self._run_psql(statement)
        if create.get("ok", False):
            self.write(f"Created user {email_value}")
            self._refresh_users()
        else:
            self.write(f"Could not create user: {create['err'] or create['out']}")

    @staticmethod
    def _generate_password():
        chars = string.ascii_letters + string.digits + "!@#$%^&*()-_=+"
        return "".join(secrets.choice(chars) for _ in range(16))

    def _pg_quote(self, value):
        if value is None:
            return "NULL"
        return "'" + str(value).replace("'", "''") + "'"

    def _build_activity_page(self):
        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        page.set_border_width(12)
        frame, body = self._container_panel("Manager activity log")
        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        self.log = Gtk.TextView(editable=False, cursor_visible=False)
        self.log.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        scroll.add(self.log)
        body.pack_start(scroll, True, True, 0)
        page.pack_start(frame, True, True, 0)
        return page

    def _build_event_table(self, rows):
        model = Gtk.ListStore(str, str, str)
        tree = Gtk.TreeView(model=model)
        tree.set_headers_visible(True)
        tree.set_grid_lines(Gtk.TreeViewGridLines.HORIZONTAL)
        for idx, title, expand in [(0, "Time", False), (1, "Type", False), (2, "Message", True)]:
            renderer = Gtk.CellRendererText()
            column = Gtk.TreeViewColumn(title, renderer, text=idx)
            column.set_expand(expand)
            if idx == 0:
                column.set_min_width(170)
            if idx == 1:
                column.set_min_width(180)
                column.set_max_width(220)
            column.set_resizable(True)
            tree.append_column(column)
        if rows == 8:
            sc = Gtk.ScrolledWindow()
            sc.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
            sc.set_size_request(-1, 190)
            sc.add(tree)
            return sc
        sc = Gtk.ScrolledWindow()
        sc.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        sc.add(tree)
        return sc

    def _metric_card(self, label):
        wrapper = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        wrapper.get_style_context().add_class("metric")

        title = Gtk.Label(label=label, xalign=0)
        title.get_style_context().add_class("metric-label")
        wrapper.pack_start(title, False, False, 0)

        value = Gtk.Label(label="—", xalign=0)
        value.get_style_context().add_class("metric-value")
        wrapper.pack_start(value, False, False, 0)

        return value

    def _button(self, text, style, callback):
        button = Gtk.Button(label=text)
        button.get_style_context().add_class("btn")
        button.get_style_context().add_class(style)
        button.connect("clicked", callback)
        return button

    def _on_nav(self, button, target):
        self._set_active_nav(target)
        self.stack.set_visible_child_name(target)

    def _set_active_nav(self, target):
        for name, button in self._nav.items():
            context = button.get_style_context()
            if name == target:
                context.add_class("active")
            else:
                context.remove_class("active")

    def _goto_events(self, _button):
        self._set_active_nav("events")
        self.stack.set_visible_child_name("events")

    def write(self, text):
        if not hasattr(self, "log"):
            return
        buffer = self.log.get_buffer()
        buffer.insert(buffer.get_end_iter(), text.rstrip() + "\n")
        self.log.scroll_to_iter(buffer.get_end_iter(), 0, False, 0, 0)

    def _set_busy(self, enabled: bool):
        self._busy = enabled
        controls = [self.deploy, self.rollback, getattr(self, "event_filter", None), getattr(self, "event_search", None)]
        for control in controls:
            if control is None:
                continue
            control.set_sensitive(not enabled)

    @staticmethod
    def _valid_sha(value):
        return bool(re.fullmatch(r"[0-9a-fA-F]{40}", value))

    @staticmethod
    def _truncate(value, limit=60):
        value = "" if value is None else str(value)
        return value if len(value) <= limit else f"{value[: max(1, limit - 1)]}…"

    def command(self, args, privileged=False):
        return (["sudo"] + list(args) if privileged else list(args))

    def _open_terminal(self, label, script):
        terminal_candidates = [
            "xfce4-terminal",
            "gnome-terminal",
            "konsole",
            "xterm",
        ]
        command = f"bash -lc {shlex.quote(script)}"
        for terminal in terminal_candidates:
            try:
                subprocess.Popen([terminal, "--title", f"Axora {label}", "--", "-lc", script])
                self.write(f"{label}: opened in {terminal}.")
                return
            except FileNotFoundError:
                pass
            except Exception as exc:
                self.write(f"Unable to open terminal for {label}: {exc}")
                return
        self.write("No terminal emulator found. Run command manually from the console.")

    def run_action(self, label, args, privileged_terminal=True):
        if self._busy:
            return

        if args and args[0] == "sudo" and privileged_terminal:
            command = " ".join(shlex.quote(part) for part in args)
            self._open_terminal(label, f"{command}; code=$?; echo; echo 'Finished with exit code' $code; read -r -p 'Press Enter to close...'")
            self.write(f"{label}: opened in terminal. Enter your password there if requested.")
            GLib.timeout_add_seconds(10, self.refresh)
            return

        self._set_busy(True)
        self.write(f"{label}… authentication may be requested.")

        def worker():
            try:
                process = subprocess.run(
                    args,
                    cwd=ROOT,
                    text=True,
                    capture_output=True,
                    timeout=7200,
                )
                output = (process.stdout + process.stderr).strip()
                if not output:
                    output = "Completed successfully." if process.returncode == 0 else "No output."
                GLib.idle_add(self.write, output)
                GLib.idle_add(self.write, f"{label}: {'completed' if process.returncode == 0 else 'failed'}")
            except Exception as exc:
                GLib.idle_add(self.write, f"{label}: {exc}")
            finally:
                GLib.idle_add(self._done)

        threading.Thread(target=worker, daemon=True).start()

    def _done(self):
        self._set_busy(False)
        self.refresh()
        return False

    def deploy_clicked(self, _button):
        self.run_action("Deployment", self.command(["systemctl", "start", "axora-deploy.service"], True))

    def rollback_clicked(self, _button):
        dialog = Gtk.MessageDialog(
            self,
            Gtk.DialogFlags.MODAL,
            Gtk.MessageType.WARNING,
            Gtk.ButtonsType.OK_CANCEL,
            "Rollback the current application release?",
        )
        dialog.format_secondary_text(
            "The database and uploaded files are preserved. Only the application release is changed."
        )
        response = dialog.run()
        dialog.destroy()
        if response == Gtk.ResponseType.OK:
            self.run_action("Rollback", self.command(["/usr/local/libexec/axora-production/rollback.sh"], True))

    def rollback_selected(self, _button):
        selected = self.releases.get_active_text() if self.releases.get_active_text() else ""
        target_sha = self._release_index.get(selected, "")
        if not target_sha and selected:
            possible = selected.split(" | ")[0]
            target_sha = possible if self._valid_sha(possible) else ""

        if not self._valid_sha(target_sha):
            self.write("Select a built release before rolling back.")
            return

        dialog = Gtk.MessageDialog(
            self,
            Gtk.DialogFlags.MODAL,
            Gtk.MessageType.WARNING,
            Gtk.ButtonsType.OK_CANCEL,
            "Rollback to selected release?",
        )
        dialog.format_secondary_text("Only the application release is changed. Database and uploaded files stay intact.")
        response = dialog.run()
        dialog.destroy()
        if response != Gtk.ResponseType.OK:
            return

        self.run_action("Rollback", self.command(["/usr/local/libexec/axora-production/rollback.sh", target_sha], True))

    def open_release_manifest(self, _button):
        self._open_terminal(
            "release manifest",
            "ls -la /var/lib/axora-production/releases; echo; ls -la /var/lib/axora-production/backups || true",
        )

    def users_clicked(self, _button):
        self._set_active_nav("users")
        self.stack.set_visible_child_name("users")

    def open_deploy_terminal_logs(self, _button):
        self._open_terminal("deploy logs", "journalctl -fu axora-deploy.service")

    @staticmethod
    def _mask_env_value(key, value):
        key_lower = key.lower()
        if any(token in key_lower for token in SENSITIVE_ENV_KEYS):
            return "••••••••••"
        if value in ("", None):
            return "(empty)"
        if len(value) > 150:
            return f"{value[:50]}…{value[-20:]}"
        return value

    def _read_env_snapshot(self, path):
        try:
            result = subprocess.run(
                ["sudo", "cat", path],
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
            if result.returncode != 0:
                return None
            rows = []
            for line in result.stdout.splitlines():
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                rows.append((key.strip(), value.strip()))
            return rows
        except Exception as exc:
            self.write(f"Settings read failed: {exc}")
            return None

    def settings_clicked(self, _button):
        output = []
        for name, path in ENV_FILES.items():
            rows = self._read_env_snapshot(path)
            output.append(f"{name}: {path}")
            if rows is None:
                output.append("  unavailable (requires sudo access or file is not readable)")
            elif not rows:
                output.append("  no variables found")
            else:
                for key, value in rows:
                    output.append(f"  {key}={self._mask_env_value(key, value)}")
            output.append("")

        output.append("Passwords are never shown. Secret-like keys are intentionally hidden.")

        dialog = Gtk.Dialog(title="Production settings", transient_for=self, flags=Gtk.DialogFlags.MODAL)
        dialog.add_button("Close", Gtk.ResponseType.CLOSE)
        dialog.set_default_size(960, 420)
        body = dialog.get_content_area()
        body.set_border_width(14)

        notice = Gtk.Label(xalign=0)
        notice.set_text("Use /etc/axora-production/deploy.env and /etc/axora-production/runtime.env as the authoritative source.")
        body.pack_start(notice, False, False, 6)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        text_view = Gtk.TextView(editable=False, monospace=True)
        text_view.set_wrap_mode(Gtk.WrapMode.WORD)
        text_view.get_buffer().set_text("\n".join(output))
        scroll.add(text_view)
        body.pack_start(scroll, True, True, 0)

        dialog.show_all()
        dialog.run()
        dialog.destroy()

    @staticmethod
    def _parse_event(line):
        line = line.strip()
        if not line:
            return ("", "", "")
        match = re.match(r"^([0-9T:\.\+\-:Z]+)\s+\S+\s+\S+\[[0-9]+\]:\s*(.*)$", line)
        if match:
            raw_time, message = match.groups()
            try:
                parsed = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
                event_time = parsed.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                event_time = raw_time
            message = message.strip()
        else:
            message = line
            event_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        lower = message.lower()
        if "image" in lower and "pull" in lower and ("fail" in lower or "error" in lower):
            event_type = "Image Pull failed"
        elif "deploy" in lower and ("start" in lower or "running" in lower):
            event_type = "Deploy started"
        elif "deploy" in lower and ("end" in lower or "success" in lower or "complete" in lower):
            event_type = "Deploy ended"
        elif "failed" in lower or "error" in lower or "denied" in lower:
            event_type = "Failed"
        elif "deploy" in lower:
            event_type = "Deploy"
        else:
            event_type = "Info"
        return event_time, event_type, message

    def _event_visible(self, event):
        _, event_type, message = event
        selected = (self.event_filter.get_active_text() or "All events").strip()
        needle = self.event_search.get_text().strip().lower()

        if needle and needle not in message.lower():
            return False

        if selected == "All events":
            return True
        if selected == "Deploy":
            return event_type in {"Deploy", "Deploy started", "Deploy ended", "Image Pull failed"}
        if selected == "Failed":
            return event_type in {"Failed", "Image Pull failed"}
        return event_type == selected

    def _collect_release_records(self):
        def run(cmd):
            try:
                return subprocess.run(cmd, text=True, capture_output=True, timeout=8).stdout.strip()
            except Exception:
                return ""

        history = run([
            "git",
            "-C",
            str(ROOT),
            "log",
            "--max-count=80",
            "--date=short",
            "--pretty=format:%H|%ad|%s",
        ])
        built = {
            token for token in run(["docker", "images", "axora-app", "--format", "{{.Tag}}"]).splitlines()
            if self._valid_sha(token.strip())
        }

        records = []
        for line in history.splitlines():
            parts = line.split("|", 2)
            if len(parts) != 3:
                continue
            commit, date, subject = parts
            if not self._valid_sha(commit):
                continue
            records.append((commit, date, self._truncate(subject, 72), commit in built))
        return records

    def _refresh_releases(self):
        records = self._collect_release_records()
        history_lines = [
            f"{commit[:9]} | {date} | {'built' if built else 'not built'} | {subject}"
            for commit, date, subject, built in records
        ]
        self.version_log.get_buffer().set_text(
            "\n".join(history_lines) if history_lines else "No release history found."
        )

        self._release_index = {}
        previous = self.releases.get_active_text()
        self.releases.remove_all()
        options = [
            (f"{_safe_short(commit)} | {date} | {subject}", commit)
            for commit, date, subject, built in records
            if built
        ]
        if not options:
            self.releases.append_text("No built releases available")
            self.releases.set_active(0)
            return

        for label, sha in options:
            self.releases.append_text(label)
            self._release_index[label] = sha

        if previous in self._release_index:
            for idx, row in enumerate(self.releases.get_model()):
                if row[0] == previous:
                    self.releases.set_active(idx)
                    break
            else:
                self.releases.set_active(0)
        else:
            self.releases.set_active(0)

    def _refresh_events(self, tree_container, rows=None):
        # tree_container is Gtk.ScrolledWindow (as built in _build_event_table)
        tree = None
        if isinstance(tree_container, Gtk.ScrolledWindow):
            child = tree_container.get_child()
            if isinstance(child, Gtk.TreeView):
                tree = child
            elif isinstance(child, Gtk.Viewport):
                viewport_child = child.get_child()
                if isinstance(viewport_child, Gtk.TreeView):
                    tree = viewport_child
        if tree is None:
            return
        model = tree.get_model()
        model.clear()

        output = subprocess.run(
            ["journalctl", "-u", "axora-deploy.service", "-n", "260", "--no-pager", "-o", "short-iso"],
            text=True,
            capture_output=True,
            timeout=8,
        ).stdout.strip()

        if output == self._last_journal and not self.event_search.get_text().strip():
            if rows is None:
                return
        self._last_journal = output

        rows_data = []
        for line in output.splitlines():
            parsed = self._parse_event(line)
            if parsed and self._event_visible(parsed):
                rows_data.append(parsed)

        if not rows_data:
            model.append(("—", "Info", "No events match selected filters."))
            return

        for event_time, event_type, message in rows_data[-(rows or 140):]:
            model.append((event_time, event_type, self._truncate(message, 380)))

    def refresh(self, *_args):
        def run(cmd):
            try:
                return subprocess.run(cmd, text=True, capture_output=True, timeout=8).stdout.strip()
            except Exception:
                return "unavailable"

        deploy_service = run(["systemctl", "is-active", "axora-deploy.service"])
        timer = run(["systemctl", "is-active", "axora-deploy.timer"])
        backup_timer = run(["systemctl", "is-active", "axora-backup.timer"])
        tunnel = run(["systemctl", "is-active", "cloudflared.service"])
        sha = run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"])
        site = run(["curl", "-fsS", "--max-time", "5", f"{PUBLIC_URL}/api/health/ready"])
        release_images = run(["docker", "images", "axora-app", "--format", "{{.Tag}}"])

        image_count = len([line for line in release_images.splitlines() if self._valid_sha(line.strip())])
        sha_short = sha or "—"
        current = _safe_short(sha, 12)

        if sha and any(line.startswith(sha) for line in release_images.splitlines()):
            self.version.set_text(f"{sha_short} · {image_count} built release(s)")
        else:
            self.version.set_text(f"{sha_short} · {image_count} built release(s)")

        self.sha.set_text(current)
        if deploy_service in ("active", "activating"):
            self.service.set_text("DEPLOY RUNNING")
            self.status_pill.set_text("Deployment worker: running")
            self.status_pill.get_style_context().remove_class("pill-warn")
            self.status_pill.get_style_context().add_class("pill-ok")
        else:
            self.service.set_text("IDLE")
            if timer == "active":
                self.status_pill.set_text("Deployment worker: waiting for schedule")
                self.status_pill.get_style_context().remove_class("pill-ok")
                self.status_pill.get_style_context().add_class("pill-warn")
            else:
                self.status_pill.set_text("Deployment worker: idle")
                self.status_pill.get_style_context().remove_class("pill-ok")
                self.status_pill.get_style_context().add_class("pill-warn")

        if '"status":"ready"' in site:
            self.public.set_text("READY")
        else:
            self.public.set_text("CHECK")
        self.timer.set_text(timer or "inactive")

        if tunnel.startswith("active"):
            self.tunnel_pill.set_text("Cloudflare Tunnel: active")
            self.tunnel_pill.get_style_context().remove_class("pill-bad")
            self.tunnel_pill.get_style_context().add_class("pill-ok")
        else:
            self.tunnel_pill.set_text("Cloudflare Tunnel: inactive")
            self.tunnel_pill.get_style_context().remove_class("pill-ok")
            self.tunnel_pill.get_style_context().add_class("pill-bad")

        self._refresh_releases()
        self._refresh_events(self.dashboard_events, rows=8)
        self._refresh_events(self.main_events if hasattr(self, "main_events") else None)

        return True


if __name__ == "__main__":
    Manager().show_all()
    Gtk.main()
