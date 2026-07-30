#!/usr/bin/env python3
"""Small local GTK manager for the Axora production deployment."""
import subprocess
import threading
import shlex
from pathlib import Path

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk, Gdk


ROOT = Path("/srv/axora")
PUBLIC_URL = "https://axora.management"


class Manager(Gtk.Window):
    def __init__(self):
        super().__init__(title="Axora Deployment Manager")
        self.set_default_size(920, 620)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.connect("destroy", Gtk.main_quit)
        self._busy = False
        self._last_journal = ""
        self._css()

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.add(outer)
        header = Gtk.Box(spacing=16)
        header.get_style_context().add_class("header")
        header.set_border_width(24)
        outer.pack_start(header, False, False, 0)
        title_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        header.pack_start(title_box, True, True, 0)
        title = Gtk.Label(label="Axora Deployment Manager", xalign=0)
        title.get_style_context().add_class("title")
        title_box.pack_start(title, False, False, 0)
        subtitle = Gtk.Label(label="Local production control", xalign=0)
        subtitle.get_style_context().add_class("subtitle")
        title_box.pack_start(subtitle, False, False, 0)
        self.status_pill = Gtk.Label(label="Checking…")
        self.status_pill.get_style_context().add_class("pill")
        header.pack_end(self.status_pill, False, False, 0)

        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        content.set_border_width(24)
        outer.pack_start(content, True, True, 0)
        cards = Gtk.Box(spacing=14)
        content.pack_start(cards, False, False, 0)
        self.sha = self._card(cards, "CURRENT RELEASE", "—")
        self.service = self._card(cards, "DEPLOY SERVICE", "—")
        self.public = self._card(cards, "PUBLIC SITE", "—")

        actions = Gtk.Box(spacing=10)
        content.pack_start(actions, False, False, 0)
        self.deploy = self._button("Deploy approved main", "accent", self.deploy_clicked)
        self.rollback = self._button("Rollback", "danger", self.rollback_clicked)
        refresh = self._button("Refresh", "quiet", self.refresh)
        actions.pack_start(self.deploy, False, False, 0)
        actions.pack_start(self.rollback, False, False, 0)
        actions.pack_end(refresh, False, False, 0)

        frame = Gtk.Frame(label="Activity")
        content.pack_start(frame, True, True, 0)
        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        frame.add(scroll)
        self.log = Gtk.TextView(editable=False, cursor_visible=False, monospace=True)
        self.log.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        scroll.add(self.log)
        self.write("Ready. This manager operates the local production services only.")
        self.refresh()
        GLib.timeout_add_seconds(15, self.refresh)

    def _css(self):
        provider = Gtk.CssProvider()
        provider.load_from_data(b"""
        window { background: #f5f7fb; }
        .header { background: #111827; color: white; }
        .title { font-size: 22px; font-weight: 700; color: white; }
        .subtitle { color: #a9b4c7; font-size: 13px; }
        .pill { background: #1f9d68; color: white; border-radius: 14px; padding: 8px 14px; font-weight: 700; }
        .card { background: white; border-radius: 10px; padding: 15px; }
        .card-label { color: #6b7280; font-size: 11px; font-weight: 700; }
        .card-value { color: #111827; font-size: 16px; font-weight: 700; }
        button { padding: 9px 16px; border-radius: 7px; }
        button.accent { background: #2563eb; color: white; }
        button.danger { background: #dc2626; color: white; }
        button.quiet { background: #e5e7eb; color: #111827; }
        frame { border-radius: 10px; }
        textview { background: #0f172a; color: #dbeafe; padding: 12px; }
        """)
        Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    def _card(self, parent, label, value):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        box.get_style_context().add_class("card")
        box.set_size_request(240, 72)
        parent.pack_start(box, True, True, 0)
        l = Gtk.Label(label=label, xalign=0)
        l.get_style_context().add_class("card-label")
        box.pack_start(l, False, False, 0)
        v = Gtk.Label(label=value, xalign=0)
        v.get_style_context().add_class("card-value")
        box.pack_start(v, False, False, 0)
        return v

    def _button(self, text, style, callback):
        b = Gtk.Button(label=text)
        b.get_style_context().add_class(style)
        b.connect("clicked", callback)
        return b

    def write(self, text):
        buf = self.log.get_buffer()
        buf.insert(buf.get_end_iter(), text.rstrip() + "\n")
        self.log.scroll_to_iter(buf.get_end_iter(), 0, False, 0, 0)

    def command(self, args, privileged=False):
        return (["sudo"] + list(args) if privileged else list(args))

    def run_action(self, label, args):
        if self._busy:
            return
        if args and args[0] == "sudo":
            command = " ".join(shlex.quote(part) for part in args)
            terminal_script = f"{command}; code=$?; echo; echo 'Finished with exit code' $code; read -r -p 'Press Enter to close...'"
            try:
                subprocess.Popen([
                    "xfce4-terminal", "--title", f"Axora {label}",
                    "--command", f"bash -lc {shlex.quote(terminal_script)}",
                ])
                self.write(f"{label} opened in a terminal. Enter your password there if requested.")
                GLib.timeout_add_seconds(8, self.refresh)
            except Exception as exc:
                self.write(f"Unable to open terminal: {exc}")
            return
        self._busy = True
        self.deploy.set_sensitive(False)
        self.rollback.set_sensitive(False)
        self.write(f"{label}… authentication may be requested.")

        def worker():
            try:
                p = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=7200)
                output = (p.stdout + p.stderr).strip() or ("Completed successfully." if p.returncode == 0 else "No output.")
                if p.returncode != 0 and "password is required" in output.lower():
                    output += "\nAuthenticate once in a terminal with: sudo -v"
                GLib.idle_add(self.write, output)
                GLib.idle_add(self.write, f"{label}: {'completed' if p.returncode == 0 else 'failed'}")
            except Exception as exc:
                GLib.idle_add(self.write, f"{label}: {exc}")
            finally:
                GLib.idle_add(self._done)
        threading.Thread(target=worker, daemon=True).start()

    def _done(self):
        self._busy = False
        self.deploy.set_sensitive(True)
        self.rollback.set_sensitive(True)
        self.refresh()
        return False

    def deploy_clicked(self, _button):
        self.run_action("Deployment", self.command(["systemctl", "start", "axora-deploy.service"], True))

    def rollback_clicked(self, _button):
        dialog = Gtk.MessageDialog(self, Gtk.DialogFlags.MODAL, Gtk.MessageType.WARNING, Gtk.ButtonsType.OK_CANCEL,
                                    "Rollback the current application release?")
        dialog.format_secondary_text("The database and uploaded files are preserved. Only the application release is changed.")
        response = dialog.run()
        dialog.destroy()
        if response == Gtk.ResponseType.OK:
            self.run_action("Rollback", self.command(["/usr/local/libexec/axora-production/rollback.sh"], True))

    def refresh(self, *_args):
        def get(cmd):
            try:
                return subprocess.run(cmd, text=True, capture_output=True, timeout=8).stdout.strip()
            except Exception:
                return "unavailable"
        deploy_service = get(["systemctl", "is-active", "axora-deploy.service"])
        timer = get(["systemctl", "is-active", "axora-deploy.timer"])
        service = "RUNNING" if deploy_service in ("active", "activating") else timer
        site = get(["curl", "-fsS", "--max-time", "5", f"{PUBLIC_URL}/api/health/ready"])
        sha = get(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"])
        journal = get(["journalctl", "-u", "axora-deploy.service", "-n", "8", "--no-pager", "-o", "cat"])
        self.sha.set_text(sha or "—")
        self.service.set_text(service)
        self.public.set_text("READY" if '"status":"ready"' in site else "CHECK")
        self.status_pill.set_text("Online" if '"status":"ready"' in site else "Needs attention")
        if journal and journal != self._last_journal:
            self._last_journal = journal
            self.write(journal)
        return True


if __name__ == "__main__":
    Manager().show_all()
    Gtk.main()
