"""Launch, check, drive and stop a throwaway local duro-app. Stdlib only.

Runs on Python 3.9 or later (macOS's /usr/bin/python3 is 3.9). Run from
the worktree root, one subcommand per tool call:

    v=.claude/skills/verify-duro-app/scripts/verify.py
    python3 "$v" launch                  # prints the pidfile path
    python3 "$v" doctor <pidfile>
    python3 "$v" drive <pidfile> <evidence-dir> home catalog settings admin
    python3 "$v" brief <pidfile> <evidence-dir> <feature>
    python3 "$v" cleanup <pidfile>

Every line it prints for a person is `ok: …` (stdout) or `fail: …`
(stderr). Exit 0 ok, 1 not ok, 2 a precondition is missing. `brief`
prints a browser-check brief on stdout instead.
"""

from __future__ import annotations

import contextlib
import enum
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from types import FrameType
from typing import Any

APP = "verify-duro-app"
DEADLINE_S = 120.0
TOOL_TIMEOUT_S = 10.0
# The first SSR request compiles the route graph through babel: allow it.
FIRST_PAGE_TIMEOUT_S = 60.0
DEAD = "http://127.0.0.1:9"  # the discard port: nothing listens there

# Every environment variable the app reads, by what Launch does with it.
# `env_names_in_app` scans app/ at each Launch; a name missing here stops
# Launch (exit 2) until it is classified, in the pull request that added it.
DEAD_URLS = (
    "AUTHELIA_URL",
    "FORGEJO_PUBLIC_URL",
    "FORGEJO_URL",
    "HOME_URL",
    "INVITE_BASE_URL",
    "LLDAP_URL",
    "NAS_VAULT_ADDR",
    "OIDC_ISSUER_URL",
    "OPERATOR_API_URL",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "VAULT_ADDR",
)
# Required by a layer at build even in dev; throwaway values, never real.
DUMMIES = {
    "LLDAP_ADMIN_USER": "verify",
    "LLDAP_ADMIN_PASS": "verify-not-a-secret",
    "NAS_VAULT_TOKEN": "verify-not-a-secret",
    "OIDC_CLIENT_ID": "verify",
    "OIDC_CLIENT_SECRET": "verify-not-a-secret-verify-not-a-secret",
    "SMTP_HOST": "127.0.0.1",
    "SMTP_PORT": "9",
    "SMTP_USER": "verify",
    "SMTP_PASS": "verify-not-a-secret",
    "OTEL_SERVICE_NAME": APP,
}
# Never set: each would point the app at real data or a real sink.
UNSET = (
    "DATABASE_URL",  # a real Postgres
    "DURO_DB_PATH",  # a file-backed store: skips the dev seed
    "DURO_PGLITE_SNAPSHOT",
    "DISCORD_WEBHOOK_URL",
    "FORGEJO_ADMIN_TOKEN",
    "WEBHOOK_SIGNATURE_KEY",
    "VITEST",  # would turn the dev sign-in off
)
# Read with a harmless default; left to it.
DEFAULTED = (
    "ADMIN_EMAIL",
    "ADMIN_GROUP_NAME",
    "ALLOWED_ORIGIN_SUFFIX",
    "APP_DESCRIPTION",
    "APP_NAME",
    "CATEGORY_ORDER",
    "FORGEJO_TIMEOUT_MS",
    "RECOVERY_ENABLED",
    "SMTP_FROM",
    "WORKER_HEALTH_PORT",  # the worker is not started here
)
SET_BY_LAUNCH = ("NODE_ENV", "SESSION_SECRET", "OIDC_REDIRECT_URI")
CLASSIFIED = frozenset((*DEAD_URLS, *DUMMIES, *UNSET, *DEFAULTED, *SET_BY_LAUNCH))
# holds-until: these patterns see `process.env.X`, `process.env["X"]`,
# `Config.<kind>("X")` and `require(Config|Secret)("X")` only, not
# `import.meta.env`, a computed name or another helper. Ends when the app
# reads its environment through one typed config module to import from.
ENV_PATTERN = re.compile(
    r"process\.env\.([A-Z_][A-Z0-9_]*)"
    r"|process\.env\[\"([A-Z_][A-Z0-9_]*)\"\]"
    r"|Config\.[a-zA-Z]+\(\"([A-Z_][A-Z0-9_]*)\""
    r"|require(?:Config|Secret)\(\"([A-Z_][A-Z0-9_]*)\""
)
# react-router dev copies these over process.env (vite loadEnv, every key):
# any of them would undo the isolation, so Launch refuses to start.
DOTENV_FILES = (".env", ".env.local", ".env.development", ".env.development.local")
USAGE = (
    "usage: verify.py launch | doctor PIDFILE | drive PIDFILE EVIDENCE-DIR JOURNEY... "
    "| brief PIDFILE EVIDENCE-DIR FEATURE | cleanup PIDFILE"
)


class Precondition(Exception):
    """A missing tool, repository or file: exit 2 with a fail: line."""


class ToolFailure(Exception):
    """A system tool hung or a signal was refused at run time: exit 1."""


class LaunchFailed(Exception):
    """Launch could not reach ready: exit `code` after teardown."""

    def __init__(self, reason: str, code: int = 1) -> None:
        super().__init__(reason)
        self.code = code


class NotLive(Exception):
    """Doctor or Drive found no live server for the pidfile: exit 1."""


class Interrupted(Exception):
    """SIGINT or SIGTERM during Launch: exit 130 or 143 after teardown."""

    def __init__(self, code: int) -> None:
        super().__init__(code)
        self.code = code


class Outcome(enum.Enum):
    READY = "ready"
    BIND_FAILED = "bind-failed"
    EXITED = "exited"


@dataclass(frozen=True)
class Record:
    """The pidfile: what Launch started and where its state lives."""

    pgid: int
    leader_pid: int
    leader_start: str | None
    state_dir: Path
    port: int
    log: Path

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def utc_now() -> str:
    """ISO 8601 UTC, without datetime.UTC (3.11+) or a deprecated alias."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def ok(msg: str) -> None:
    sys.stdout.write(f"ok: {msg}\n")


def fail(msg: str) -> None:
    sys.stderr.write(f"fail: {msg}\n")


def tool(name: str) -> str:
    """The absolute path of a system tool (git, ps, pgrep, lsof, node)."""
    path = shutil.which(name)
    if path is None:
        raise Precondition(f"{name} not on PATH — install it")
    return path


def run_tool(args: list[str], ok_codes: frozenset[int] = frozenset({0})) -> str:
    """Run a system tool with a deadline; its stdout, stripped.

    pgrep, lsof and ps exit 1 for "nothing matched", which callers pass in
    `ok_codes`; any other code is a failure, never read as an empty answer.
    """
    try:
        done = subprocess.run(
            [tool(args[0]), *args[1:]],
            capture_output=True,
            text=True,
            timeout=TOOL_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        raise ToolFailure(f"{args[0]} hung for {TOOL_TIMEOUT_S:.0f}s") from exc
    if done.returncode not in ok_codes:
        raise Precondition(f"{args[0]} exited {done.returncode}: {done.stderr.strip()[:200]}")
    return done.stdout.strip()


NONE_MATCHED_OK = frozenset({0, 1})


def repo_root() -> Path:
    top = run_tool(["git", "rev-parse", "--show-toplevel"])
    if not top:
        raise Precondition("not inside a git worktree — cd to the worktree root")
    return Path(top).resolve()


def pidfile_for(root: Path) -> Path:
    digest = hashlib.sha1(str(root).encode(), usedforsecurity=False)
    worktree_id = digest.hexdigest()[:12]
    return Path(tempfile.gettempdir()) / f"{APP}-{worktree_id}.json"


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f, indent=2, default=str)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_record(path: Path) -> Record | None:
    """None when there is no pidfile; Precondition when it is unreadable."""
    try:
        raw = json.loads(path.read_text())
        leader_start = raw.get("leader_start")
        if leader_start is not None and not isinstance(leader_start, str):
            raise TypeError(f"leader_start is {type(leader_start).__name__}")
        return Record(
            pgid=int(raw["pgid"]),
            leader_pid=int(raw["leader_pid"]),
            leader_start=leader_start,
            state_dir=Path(raw["state_dir"]),
            port=int(raw["port"]),
            log=Path(raw["log"]),
        )
    except FileNotFoundError:
        return None
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise Precondition(f"pidfile {path} is unreadable ({exc!r}) — inspect it, then remove it") from exc


def members(pgid: int) -> list[int]:
    return [int(pid) for pid in run_tool(["pgrep", "-g", str(pgid)], NONE_MATCHED_OK).split()]


def lstart(pid: int) -> str | None:
    return run_tool(["ps", "-o", "lstart=", "-p", str(pid)], NONE_MATCHED_OK) or None


def listener_groups(port: int) -> set[int]:
    pids = run_tool(["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"], NONE_MATCHED_OK)
    groups: set[int] = set()
    for pid in pids.split():
        pgid_text = run_tool(["ps", "-o", "pgid=", "-p", pid], NONE_MATCHED_OK)
        if pgid_text:
            groups.add(int(pgid_text))
    return groups


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A 302 to the OIDC login must be seen, not followed."""

    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def http(url: str, timeout: float = 10.0) -> tuple[int, str, str]:
    """GET, loopback only, no redirects: (status, body, Location).

    Status 0 when nothing answered.
    """
    if not url.startswith("http://127.0.0.1:"):
        raise ValueError(f"loopback only, got {url}")
    request = urllib.request.Request(url, headers={"Accept": "text/html,application/json"})
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            return response.status, response.read().decode(errors="replace"), ""
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(errors="replace"), exc.headers.get("Location", "")
    except (urllib.error.URLError, OSError) as exc:
        return 0, str(exc), ""


def stop_group(pgid: int, child: subprocess.Popen[bytes] | None = None, grace_s: float = 5.0) -> list[int]:
    """TERM the group, wait up to grace_s, then KILL. Returns survivors.

    `child` is the leader when this process started it: it is reaped while
    waiting, so a dead leader does not linger as a zombie group member.
    """
    for sig in (signal.SIGTERM, signal.SIGKILL):
        if not members(pgid):
            return []
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            return []
        except PermissionError:
            # macOS answers EPERM for a group whose members are exiting.
            if not members(pgid):
                return []
            raise ToolFailure(f"not allowed to signal group {pgid}") from None
        deadline = time.monotonic() + grace_s
        while time.monotonic() < deadline:
            if child is not None:
                child.poll()
            if not members(pgid):
                return []
            time.sleep(0.2)
    return members(pgid)


_interrupted: list[int] = []


def _on_signal(signum: int, _frame: FrameType | None) -> None:
    # Raise once. A second signal already caught by the interpreter still
    # calls this handler, during the teardown the first raise leads to; it
    # must return, not raise into the teardown. The mask holds any later
    # one (a mask, not SIG_IGN: changing a disposition while a signal is
    # pending races, "ignored due to race condition").
    signal.pthread_sigmask(signal.SIG_BLOCK, HELD_SIGNALS)
    if _interrupted:
        return
    _interrupted.append(signum)
    raise Interrupted(128 + signum)  # 129 HUP, 130 INT, 143 TERM


# HUP too: a closed tool-call shell must tear the attempt down, since the
# server runs in its own session and would outlive the launcher.
HELD_SIGNALS = {signal.SIGHUP, signal.SIGINT, signal.SIGTERM}


@contextlib.contextmanager
def signals_held() -> Iterator[None]:
    """Hold INT and TERM: they are delivered when the block ends."""
    signal.pthread_sigmask(signal.SIG_BLOCK, HELD_SIGNALS)
    try:
        yield
    finally:
        signal.pthread_sigmask(signal.SIG_UNBLOCK, HELD_SIGNALS)


def unblock_held_signals() -> None:
    signal.pthread_sigmask(signal.SIG_UNBLOCK, HELD_SIGNALS)


@dataclass
class Attempt:
    """The launch attempt in progress, for teardown from any point."""

    state: Path
    child: subprocess.Popen[bytes] | None = None


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def env_names_in_app(root: Path) -> dict[str, str]:
    """Each env name app/ reads (tests excluded), with one file reading it."""
    found: dict[str, str] = {}
    for path in sorted((root / "app").rglob("*.ts*")):
        if ".test." in path.name or path.suffix not in (".ts", ".tsx"):
            continue
        for match in ENV_PATTERN.finditer(path.read_text(errors="replace")):
            name = next(group for group in match.groups() if group)
            found.setdefault(name, str(path.relative_to(root)))
    return found


def check_isolation(root: Path, env: dict[str, str]) -> None:
    """Refuse a launch that could reach anything but loopback (exit 2)."""
    present = [name for name in DOTENV_FILES if (root / name).exists()]
    if present:
        raise LaunchFailed(
            f"{', '.join(present)} in the worktree would override the isolated "
            "environment (react-router dev loads it) — run from a fresh worktree",
            2,
        )
    unknown = {name: where for name, where in env_names_in_app(root).items() if name not in CLASSIFIED}
    if unknown:
        listed = ", ".join(f"{name} ({where})" for name, where in sorted(unknown.items()))
        raise LaunchFailed(f"unclassified env {listed} — add each to verify.py", 2)
    for name, value in env.items():
        if "://" not in value:
            continue
        host = urllib.parse.urlsplit(value).hostname
        if host != "127.0.0.1":
            raise LaunchFailed(f"{name} would reach {host} — loopback only", 2)


def node_bin() -> Path:
    """The real node binary: its directory is the server's whole PATH."""
    return Path(os.path.realpath(tool("node")))


def child_env(state: Path, port: int) -> dict[str, str]:
    """The server's whole environment: nothing is inherited."""
    home = state / "home"
    for directory in (home, state / "tmp"):
        directory.mkdir()
    env = {
        "PATH": f"{node_bin().parent}:/usr/bin:/bin",
        "HOME": str(home),
        "TMPDIR": str(state / "tmp"),
        "LANG": "en_US.UTF-8",
        "CI": "1",
        "NO_COLOR": "1",
        "BROWSER": "none",
        # development is what turns on the dev sign-in (user `dev`, admin),
        # the in-memory PGlite with its seed, and every *Dev service layer.
        "NODE_ENV": "development",
        "SESSION_SECRET": secrets.token_hex(32),
        "OIDC_REDIRECT_URI": f"http://127.0.0.1:{port}/auth/callback",
        **DUMMIES,
    }
    for name in DEAD_URLS:
        env[name] = DEAD
    write_json_atomic(state / "env.json", {k: v for k, v in env.items() if k != "SESSION_SECRET"})
    return env


def remove_dir(path: Path) -> str | None:
    """Remove a state directory; the error text when it could not be."""
    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        return None
    except OSError as exc:
        return f"could not remove {path} ({exc})"
    return None


def teardown(attempt: Attempt | None, pidfile: Path) -> bool:
    """Undo a failed or interrupted attempt: group, state dir, pidfile.

    True when everything it started is gone. False when a group may still
    run: it says so with a fail: line and keeps the state dir, and the
    caller must not start another server.

    INT and TERM are held while it runs (about 10 s at most), so a second
    Ctrl-C cannot leave it half done; the process exits right after.
    """
    if attempt is None:
        return True
    signal.pthread_sigmask(signal.SIG_BLOCK, HELD_SIGNALS)
    kept = f"state kept at {attempt.state}"
    pgid = attempt.child.pid if attempt.child is not None else None
    pgid_file = attempt.state / "pgid"
    if pgid is None and pgid_file.exists():
        try:
            pgid = int(pgid_file.read_text())
        except (OSError, ValueError) as exc:
            fail(f"teardown cannot read {pgid_file} ({exc!r}) — {kept}")
            return False
    if pgid is not None:
        try:
            survivors = stop_group(pgid, attempt.child)
        except (Precondition, ToolFailure) as exc:
            fail(f"teardown could not stop group {pgid} ({exc}) — kill it by hand; {kept}")
            return False
        if survivors:
            fail(f"teardown left group {pgid}: {' '.join(map(str, survivors))} — {kept}")
            return False
    try:
        record = read_record(pidfile)
    except Precondition as exc:
        fail(f"{exc} (left in place by teardown)")
    else:
        if record is not None and record.state_dir == attempt.state:
            pidfile.unlink(missing_ok=True)
    problem = remove_dir(attempt.state)
    if problem:
        fail(f"teardown {problem}")
        return False
    return True


def not_ready(pgid: int, port: int) -> str:
    """Why the server is not usable yet; "" once it is.

    Ready: our group serves the port, the DB answers, and a page renders.
    """
    groups = listener_groups(port)
    if pgid not in groups:
        # A foreign server on our port never counts.
        return f"no listener on :{port} in group {pgid} (listeners' groups: {sorted(groups)})"
    status, body, _ = http(f"http://127.0.0.1:{port}/health/ready", timeout=5)
    if status != 200:
        return f"/health/ready answered {status}: {body[:120]}"
    # The first SSR render compiles the routes: ready means usable.
    status, body, _ = http(f"http://127.0.0.1:{port}/", timeout=FIRST_PAGE_TIMEOUT_S)
    if status != 200 or "<html" not in body:
        return f"/ answered {status} without a page: {body[:120]}"
    return ""


def print_tail(log: Path, pidfile: Path) -> Path:
    """The last 20 lines to stderr; the log kept beside the pidfile.

    The teardown removes the state directory, so the path it names is a
    copy that outlives it.
    """
    kept = pidfile.with_suffix(".last.log")
    shutil.copy(log, kept)
    lines = log.read_text(errors="replace").splitlines()[-20:]
    sys.stderr.write("\n".join(lines) + f"\nlog: {kept}\n")
    return kept


def server_cmd(root: Path, port: int) -> list[str]:
    # The pnpm shim, never `node …/bin.js`: the shim's NODE_PATH is what
    # lets babel resolve @stylexjs/babel-plugin (vite.config.ts names it,
    # and it is only a dependency of react-strict-dom). Without it every
    # page is a 500 "Cannot find module '@stylexjs/babel-plugin'".
    shim = root / "node_modules/.bin/react-router"
    if not shim.exists():
        raise Precondition("no node_modules — run pnpm install --frozen-lockfile")
    # --strictPort: without it vite moves to the next free port silently.
    return [str(shim), "dev", "--host", "127.0.0.1", "--port", str(port), "--strictPort"]


def run_attempt(root: Path, pidfile: Path, attempt: Attempt) -> Outcome:
    port = free_port()
    env = child_env(attempt.state, port)
    check_isolation(root, env)
    log_path = attempt.state / "server.log"
    cmd = server_cmd(root, port)
    # A signal between Popen and the pgid write would orphan the server:
    # hold INT and TERM until the group id is on disk.
    with signals_held():
        with open(log_path, "a") as log:
            attempt.child = subprocess.Popen(
                cmd,
                cwd=root,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                # A blocked mask survives exec: the server must get its
                # INT and TERM back, or Cleanup's TERM would be ignored.
                preexec_fn=unblock_held_signals,
            )
        (attempt.state / "pgid").write_text(str(attempt.child.pid))
    child = attempt.child
    write_json_atomic(
        pidfile,
        {
            "pgid": child.pid,
            "leader_pid": child.pid,
            "leader_start": lstart(child.pid),
            "cmd": cmd,
            "state_dir": str(attempt.state),
            "port": port,
            "log": str(log_path),
            "started_at": utc_now(),
        },
    )
    deadline = time.monotonic() + DEADLINE_S
    reason = "not checked yet"
    while time.monotonic() < deadline:
        if child.poll() is not None:
            if "already in use" in log_path.read_text(errors="replace"):
                return Outcome.BIND_FAILED
            print_tail(log_path, pidfile)
            return Outcome.EXITED
        reason = not_ready(child.pid, port)
        if not reason:
            return Outcome.READY
        time.sleep(0.5)
    kept = print_tail(log_path, pidfile)
    raise LaunchFailed(f"not ready in {DEADLINE_S:.0f}s, last: {reason} — log {kept}")


def cmd_launch() -> int:
    root = repo_root()
    pidfile = pidfile_for(root)
    record = read_record(pidfile)
    if record is not None and members(record.pgid):
        fail(f"already running, pgid {record.pgid} — run cleanup {pidfile}")
        return 1
    server_cmd(root, 0)  # the node_modules precondition, before any state
    # On stderr before anything starts: a Launch killed by a tool timeout
    # (SIGKILL, uncatchable) never reaches the stdout line, and Cleanup
    # needs this path.
    sys.stderr.write(f"pidfile: {pidfile}\n")
    attempt: Attempt | None = None
    try:
        # holds-until: two Launches in the same worktree at the same
        # instant both pass the already-running check above; the skill
        # says so. Ends when a lock with a release is added (the O_EXCL
        # lock was dropped for having none).
        for sig in HELD_SIGNALS:
            signal.signal(sig, _on_signal)
        for try_number in (1, 2):
            attempt = Attempt(Path(tempfile.mkdtemp(prefix=f"{APP}-")))
            outcome = run_attempt(root, pidfile, attempt)
            if outcome is Outcome.READY:
                for sig in HELD_SIGNALS:
                    signal.signal(sig, signal.SIG_DFL)
                sys.stdout.write(f"{pidfile}\n")
                return 0
            torn_down = teardown(attempt, pidfile)
            attempt = None
            if not torn_down:
                return 1  # a group may still run: never start a second one
            if outcome is Outcome.EXITED or try_number == 2:
                fail(f"server exited during launch ({outcome.value})")
                return 1
            # The bind-failed retry: the teardown held INT and TERM.
            unblock_held_signals()
        return 1
    except Interrupted as exc:
        teardown(attempt, pidfile)
        return exc.code
    except LaunchFailed as exc:
        teardown(attempt, pidfile)
        fail(str(exc))
        return exc.code
    except BaseException:
        teardown(attempt, pidfile)
        raise


def live_record(pidfile: Path) -> Record:
    """The record of a group that is alive and owns its port, or fail."""
    record = read_record(pidfile)
    if record is None:
        raise Precondition(f"no pidfile at {pidfile} — run verify.py launch")
    if not members(record.pgid):
        raise NotLive(f"group {record.pgid} is gone — run verify.py cleanup {pidfile}")
    if record.pgid not in listener_groups(record.port):
        raise NotLive(f":{record.port} is not served by group {record.pgid} — run cleanup, then launch")
    return record


def seeded_apps(record: Record) -> tuple[list[str], str]:
    """The dev user's catalog, and why it could not be read ("" if read).

    An empty list read without error means no seed (a file-backed store).
    """
    status, body, _ = http(f"{record.base}/api/catalog")
    if status != 200:
        return [], f"/api/catalog answered {status}"
    try:
        apps = json.loads(body).get("apps", [])
    except (ValueError, AttributeError) as exc:
        return [], f"/api/catalog is not the expected JSON ({exc})"
    return [str(app.get("name") or app.get("slug") or "?") for app in apps], ""


def cmd_doctor(pidfile: Path) -> int:
    try:
        record = live_record(pidfile)
    except NotLive as exc:
        fail(str(exc))
        return 1
    status, _, _ = http(f"{record.base}/health/ready", timeout=5)
    if status != 200:
        fail(f"/health/ready {status} on :{record.port} — read {record.log}")
        return 1
    # Wired, not only answering: production auth would 302 to OIDC here.
    status, _, location = http(f"{record.base}/admin", timeout=FIRST_PAGE_TIMEOUT_S)
    if status != 200:
        fail(f"/admin {status} {location} — no dev sign-in; read {record.log}")
        return 1
    apps, problem = seeded_apps(record)
    if problem:
        fail(f"{problem} on :{record.port} — read {record.log}")
        return 1
    if not apps:
        fail(f"catalog empty on :{record.port} — no dev seed; read {record.log}")
        return 1
    ok(f"ready on :{record.port}, dev sign-in, {len(apps)} seeded apps")
    return 0


@dataclass(frozen=True)
class Page:
    """One server-rendered page and the text that proves its content."""

    path: str
    markers: tuple[str, ...]


# The fallback when no browser drives the app: the server-rendered HTML of
# each feature's page, as the dev user, with seeded content on it. It
# proves routing, loaders, sign-in and seed, not clicks or layout.
JOURNEYS: dict[str, tuple[Page, ...]] = {
    "home": (Page("/", ("Welcome, dev", "Grafana")),),
    "catalog": (Page("/catalog", ("KB Vision", "Grafana")),),
    "settings": (Page("/settings", ("General", "Git access")), Page("/settings/api-keys", ("API keys",))),
    "admin": (Page("/admin/identities", ("Alice", "Bob")), Page("/admin/applications", ("Jellyfin",))),
}


def drive_pages(record: Record, pages: tuple[Page, ...]) -> dict[str, Any]:
    checks = []
    for page in pages:
        status, body, location = http(f"{record.base}{page.path}", timeout=FIRST_PAGE_TIMEOUT_S)
        missing = [marker for marker in page.markers if marker not in body]
        checks.append(
            {
                "action": f"GET {page.path} as dev",
                "status": status,
                "location": location,
                "markers": list(page.markers),
                "missing": missing,
                "bytes": len(body),
                "passed": status == 200 and not missing,
            }
        )
    return {
        "passed": all(check["passed"] for check in checks),
        "checks": checks,
        "not_proven": "clicks, client-side state and layout: browser-check",
    }


def evidence_dir_for(evidence: Path) -> Path:
    root = repo_root()
    evidence_dir = evidence.resolve()
    if evidence_dir == root or root in evidence_dir.parents:
        raise Precondition("evidence dir is inside the worktree — use the F3 directory")
    return evidence_dir


def cmd_drive(pidfile: Path, evidence: Path, journeys: list[str]) -> int:
    unknown = [name for name in journeys if name not in JOURNEYS]
    if unknown:
        raise Precondition(f"unknown journey {', '.join(unknown)} — pick from {', '.join(JOURNEYS)}")
    evidence_dir = evidence_dir_for(evidence)
    try:
        record = live_record(pidfile)
    except NotLive as exc:
        fail(str(exc))
        return 1
    evidence_dir.mkdir(parents=True, exist_ok=True)
    rc = 0
    try:
        for name in journeys:
            try:
                journey_result = drive_pages(record, JOURNEYS[name])
            except Exception as exc:  # recorded as a failed journey, never lost
                journey_result = {"passed": False, "error": repr(exc)}
            journey_result["journey"] = name
            journey_result["at"] = utc_now()
            out = evidence_dir / f"{APP}-{name}.json"
            write_json_atomic(out, journey_result)
            if journey_result["passed"]:
                ok(f"{name} passed — {out}")
            else:
                fail(f"{name} failed — read {out}")
                rc = 1
    finally:
        try:
            shutil.copy(record.log, evidence_dir / f"{APP}-server.log")
        except OSError as exc:
            fail(f"could not copy the server log ({exc}) — run launch again")
            rc = 1
    return rc


BRIEF = """\
Check {feature} of duro-app, a local dev server started for this check.

- Open {base}{route} with new_page and isolatedContext "{context}".
  No sign-in: the dev server signs every request in as user `dev`
  (admin). A login page or a redirect to another host is a failure.
- Viewport {viewport}, theme {theme}.
- The first visit to each route after Launch can show "Application
  Error!" with "Invalid hook call" or "reading 'useContext'": vite
  re-optimises a client dependency it found late. Reload once,
  ignoring the cache, and report that it happened. The same error
  after that reload is a failure.
- Steps and questions:{steps}
- Read the console and the network list: report every error and every
  request to a host other than 127.0.0.1.
- Save screenshots as {evidence}/{app}-{feature}-<n>-<width>.png,
  where <n> is the step number and <width> the viewport width; report
  each path, and the final URL.
- Report measured facts only; no verdict on design quality.
"""


def cmd_brief(pidfile: Path, evidence: Path, feature: str) -> int:
    root = repo_root()
    feature_file = root / ".claude/skills/verify-duro-app/features" / f"{feature}.md"
    if not feature_file.exists():
        raise Precondition(f"no feature file {feature_file.name} — see features/README.md")
    evidence_dir = evidence_dir_for(evidence)
    try:
        record = live_record(pidfile)
    except NotLive as exc:
        fail(str(exc))
        return 1
    evidence_dir.mkdir(parents=True, exist_ok=True)
    text = feature_file.read_text()
    route = re.search(r"^Route: `([^`]+)`", text, re.M)
    steps = re.search(r"^## Driving it\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    if route is None or steps is None:
        raise Precondition(f"{feature_file.name} lacks a Route: line or a Driving it section")
    sys.stdout.write(
        BRIEF.format(
            feature=feature,
            base=record.base,
            route=route.group(1),
            context=f"{APP}-{feature}-{secrets.token_hex(3)}",
            viewport="1280x800, then 390x844",
            theme="light",
            steps="\n" + steps.group(1).strip(),
            evidence=evidence_dir,
            app=APP,
        )
    )
    return 0


def cmd_cleanup(pidfile: Path) -> int:
    record = read_record(pidfile)
    if record is None:
        fail(f"no pidfile at {pidfile} — nothing to stop")
        return 1
    now_start = lstart(record.leader_pid)
    if now_start is not None and record.leader_start is None:
        # No start time was recorded: ours and a reuse look alike.
        fail(f"{record.pgid} has no recorded start time — check pgrep -g {record.pgid} by hand")
        return 1
    if now_start is not None and now_start != record.leader_start:
        # The id was reused by someone else's process: never signal it.
        problem = remove_dir(record.state_dir)
        if problem:
            fail(problem)
            return 1
        pidfile.unlink(missing_ok=True)
        ok(f"{record.pgid} reused, nothing signalled")
        return 0
    survivors = stop_group(record.pgid) if members(record.pgid) else []
    if survivors:
        fail(f"{record.pgid} still has {' '.join(map(str, survivors))}")
        return 1
    problem = remove_dir(record.state_dir)
    if problem:
        fail(problem)
        return 1
    pidfile.unlink(missing_ok=True)
    ok(f"stopped {record.pgid}, removed {record.state_dir}")
    return 0


def dispatch(argv: list[str]) -> int:
    if "-h" in argv or "--help" in argv:
        sys.stdout.write(f"{USAGE}\n")
        return 0
    command, rest = (argv[0], argv[1:]) if argv else ("", [])
    if command == "launch" and not rest:
        return cmd_launch()
    if command == "doctor" and len(rest) == 1:
        return cmd_doctor(Path(rest[0]))
    if command == "drive" and len(rest) >= 3:
        return cmd_drive(Path(rest[0]), Path(rest[1]), rest[2:])
    if command == "brief" and len(rest) == 3:
        return cmd_brief(Path(rest[0]), Path(rest[1]), rest[2])
    if command == "cleanup" and len(rest) == 1:
        return cmd_cleanup(Path(rest[0]))
    fail(f"bad arguments {argv!r} — {USAGE}")
    return 2


def main(argv: list[str]) -> int:
    try:
        return dispatch(argv)
    except Precondition as exc:
        fail(str(exc))
        return 2
    except ToolFailure as exc:
        fail(str(exc))
        return 1
    except KeyboardInterrupt:
        fail("interrupted — run the step again (cleanup is safe to repeat)")
        return 130


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
