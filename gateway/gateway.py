"""Local, authenticated WebSocket-to-Telnet gateway."""

import argparse
import asyncio
import csv
import hmac
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

LOGGER = logging.getLogger("telnet-gateway")
DEFAULT_ORIGIN = "https://chpaxson.github.io"
PORT = 8765
MAX_TARGETS = 100
SHORTCUT_NAME = "Serial Console Telnet Gateway.lnk"
SHORTCUT_MARKER = "Serial Console Telnet Gateway startup"
IAC, DONT, DO, WONT, WILL, SB, SE = 255, 254, 253, 252, 251, 250, 240


class TelnetDecoder:
    def __init__(self):
        self.state = "data"
        self.command = 0

    def push(self, chunk):
        data, replies = bytearray(), bytearray()
        for byte in chunk:
            if self.state == "data":
                if byte == IAC:
                    self.state = "iac"
                else:
                    data.append(byte)
            elif self.state == "iac":
                if byte == IAC:
                    data.append(byte)
                    self.state = "data"
                elif byte in (DO, DONT, WILL, WONT):
                    self.command = byte
                    self.state = "option"
                elif byte == SB:
                    self.state = "sub"
                else:
                    self.state = "data"
            elif self.state == "option":
                if self.command == DO:
                    replies.extend((IAC, WONT, byte))
                elif self.command == WILL:
                    replies.extend((IAC, DONT, byte))
                self.state = "data"
            elif self.state == "sub":
                if byte == IAC:
                    self.state = "sub-iac"
            else:
                self.state = "data" if byte == SE else "sub"
        return bytes(data), bytes(replies)


def encode_telnet(data):
    return data.replace(b"\xff", b"\xff\xff")


def validate_origin(value):
    if not isinstance(value, str):
        raise ValueError("Invalid origin")
    parts = urlsplit(value)
    if (parts.scheme not in ("https", "http") or not parts.hostname or parts.username or
            parts.password or parts.path or parts.query or parts.fragment):
        raise ValueError(f"Invalid origin: {value}")
    try:
        port = parts.port
    except ValueError as exc:
        raise ValueError(f"Invalid origin: {value}") from exc
    if port == 0:
        raise ValueError(f"Invalid origin: {value}")
    if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("HTTP origins are allowed only for localhost development")
    host = parts.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    default_port = 443 if parts.scheme == "https" else 80
    return f"{parts.scheme}://{host}" + (f":{port}" if port and port != default_port else "")


def validate_target(host, port):
    if not isinstance(host, str) or not host or len(host) > 253:
        raise ValueError("Enter a valid host")
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ValueError("Port must be an integer from 1 to 65535")
    host = host.strip().lower()
    if host.startswith("[") and host.endswith("]"):
        try:
            host = f"[{ipaddress.IPv6Address(host[1:-1]).compressed}]"
        except ValueError as exc:
            raise ValueError("Invalid IPv6 address") from exc
    elif not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host):
        raise ValueError("Enter a hostname, IPv4 address, or bracketed IPv6 address")
    return {"host": host, "port": port}


def config_dir():
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            raise RuntimeError("LOCALAPPDATA is not set")
        return Path(local) / "SerialConsoleGateway"
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "serial-console-gateway"


def create_private_directory(path):
    path.mkdir(mode=0o700, parents=False, exist_ok=False)
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        result = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"],
                                check=True, capture_output=True, text=True)
        sid = next(csv.reader(result.stdout.splitlines()))[1]
        if not re.fullmatch(r"S-1-(?:\d+-)*\d+", sid):
            raise RuntimeError("Could not determine the current Windows user SID")
        advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.DWORD)]
        advapi.GetSecurityDescriptorDacl.argtypes = [
            ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.BOOL)]
        advapi.SetNamedSecurityInfoW.argtypes = [
            wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p,
            ctypes.c_void_p, ctypes.c_void_p]
        advapi.SetNamedSecurityInfoW.restype = wintypes.DWORD
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        descriptor = ctypes.c_void_p()
        if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
                f"D:P(A;OICI;FA;;;{sid})", 1, ctypes.byref(descriptor), None):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            present, defaulted, dacl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
            if not advapi.GetSecurityDescriptorDacl(descriptor, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted)):
                raise ctypes.WinError(ctypes.get_last_error())
            error = advapi.SetNamedSecurityInfoW(str(path), 1, 0x80000004, None, None, dacl, None)
            if error:
                raise ctypes.WinError(error)
        finally:
            kernel.LocalFree(descriptor)
    else:
        path.chmod(0o700)


def save_config(path, config):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            if os.name != "nt":
                os.fchmod(file.fileno(), 0o600)
            json.dump(config, file, indent=2)
            file.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def load_config(path):
    with path.open(encoding="utf-8") as file:
        config = json.load(file)
    if not isinstance(config, dict) or not isinstance(config.get("token"), str) or len(config["token"]) < 40:
        raise ValueError("Invalid gateway configuration")
    origins = config.get("origins")
    targets = config.get("targets")
    if not isinstance(origins, list) or not origins or not isinstance(targets, list) or len(targets) > MAX_TARGETS:
        raise ValueError("Invalid gateway configuration")
    try:
        config["origins"] = [validate_origin(origin) for origin in origins]
        config["targets"] = [validate_target(target["host"], target["port"]) for target in targets]
    except (KeyError, TypeError) as exc:
        raise ValueError("Invalid gateway configuration") from exc
    return config


class Gateway:
    def __init__(self, path, config):
        self.path = path
        self.config = config
        self.control_clients = set()
        self.connections = {}

    async def targets_update(self):
        message = json.dumps({"type": "targets", "targets": self.config["targets"]})
        results = await asyncio.gather(
            *(client.send(message) for client in tuple(self.control_clients)),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception) and not isinstance(result, ConnectionClosed):
                LOGGER.error("Could not send updated targets: %s", result)

    async def control(self, ws):
        self.control_clients.add(ws)
        try:
            await ws.send(json.dumps({"type": "targets", "targets": self.config["targets"]}))
            async for raw in ws:
                if not isinstance(raw, str):
                    await ws.close(1008, "Expected a control request")
                    return
                try:
                    request = json.loads(raw)
                    if not isinstance(request, dict) or request.get("type") not in ("add", "remove"):
                        raise ValueError("Invalid control request")
                    target = validate_target(request.get("host"), request.get("port"))
                    targets = self.config["targets"].copy()
                    if request["type"] == "add" and target not in targets:
                        if len(targets) >= MAX_TARGETS:
                            raise ValueError("Too many targets")
                        targets.append(target)
                    elif request["type"] == "remove" and target in targets:
                        targets.remove(target)
                    updated = {**self.config, "targets": targets}
                    save_config(self.path, updated)
                    self.config = updated
                    if request["type"] == "remove":
                        await asyncio.gather(*(client.close(1008, "Target removed")
                            for client, current in tuple(self.connections.items()) if current == target))
                    await self.targets_update()
                except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                    await ws.send(json.dumps({"type": "error", "message": str(exc)}))
                except OSError:
                    LOGGER.exception("Could not save gateway configuration")
                    await ws.send(json.dumps({"type": "error", "message": "Could not save gateway configuration"}))
        finally:
            self.control_clients.discard(ws)

    async def relay(self, ws, target):
        if target not in self.config["targets"]:
            await ws.close(1008, "Target not allowed by gateway")
            return
        try:
            host = target["host"].strip("[]")
            reader, writer = await asyncio.wait_for(asyncio.open_connection(host, target["port"]), 10)
        except (OSError, TimeoutError) as exc:
            LOGGER.warning("Telnet connection failed: %s", exc)
            await ws.close(1011, "Could not connect to Telnet target")
            return
        if target not in self.config["targets"]:
            writer.close()
            await writer.wait_closed()
            await ws.close(1008, "Target removed")
            return
        self.connections[ws] = target
        decoder = TelnetDecoder()

        async def receive_tcp():
            while chunk := await reader.read(65536):
                data, replies = decoder.push(chunk)
                if replies:
                    writer.write(replies)
                    await writer.drain()
                if data:
                    await ws.send(data)
            await ws.close(1000, "Telnet connection closed")

        async def receive_websocket():
            async for data in ws:
                if not isinstance(data, bytes):
                    await ws.close(1008, "Expected binary data")
                    return
                writer.write(encode_telnet(data))
                await writer.drain()

        try:
            await ws.send(json.dumps({"type": "ready"}))
            tasks = [asyncio.create_task(receive_tcp()), asyncio.create_task(receive_websocket())]
            try:
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    task.result()
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        except (ConnectionClosed, OSError) as exc:
            LOGGER.info("Telnet session ended: %s", exc)
            if not isinstance(exc, ConnectionClosed):
                await ws.close(1011, "Telnet connection failed")
        finally:
            self.connections.pop(ws, None)
            writer.close()
            try:
                await writer.wait_closed()
            except OSError as exc:
                LOGGER.info("Telnet socket close failed: %s", exc)

    async def handle(self, ws):
        if ws.request.path != "/":
            await ws.close(1008, "Invalid gateway path")
            return
        try:
            raw = await asyncio.wait_for(ws.recv(), 10)
            request = json.loads(raw) if isinstance(raw, str) else None
            token = request.get("token") if isinstance(request, dict) else None
            if not isinstance(token, str) or not hmac.compare_digest(token.encode("utf-8"), self.config["token"].encode("utf-8")):
                await asyncio.sleep(0.5)
                await ws.close(1008, "Authentication failed")
                return
            if request.get("type") == "control":
                await self.control(ws)
            elif request.get("type") == "connect":
                try:
                    target = validate_target(request.get("host"), request.get("port"))
                except ValueError:
                    await ws.close(1008, "Invalid target")
                    return
                await self.relay(ws, target)
            else:
                await ws.close(1008, "Invalid request")
        except (TimeoutError, json.JSONDecodeError):
            await ws.close(1008, "Invalid authentication request")
        except ConnectionClosed:
            pass

    async def run(self):
        async with serve(self.handle, "127.0.0.1", PORT, origins=self.config["origins"], max_size=65536):
            LOGGER.info("Gateway listening on 127.0.0.1:%s", PORT)
            await asyncio.Future()


def startup(action):
    if os.name != "nt":
        raise RuntimeError("Startup installation is currently supported only on Windows")
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise RuntimeError("APPDATA is not set")
    shortcut = Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / SHORTCUT_NAME
    env = os.environ.copy()
    env.update(GATEWAY_SHORTCUT=str(shortcut), GATEWAY_MARKER=SHORTCUT_MARKER)
    if action == "install-startup":
        if shortcut.exists():
            raise FileExistsError(f"Startup shortcut already exists: {shortcut}")
        args = ["run"] if getattr(sys, "frozen", False) else [str(Path(__file__).resolve()), "run"]
        env.update(GATEWAY_EXECUTABLE=sys.executable, GATEWAY_ARGUMENTS=subprocess.list2cmdline(args))
        script = ("$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($env:GATEWAY_SHORTCUT); "
                  "$s.TargetPath=$env:GATEWAY_EXECUTABLE; $s.Arguments=$env:GATEWAY_ARGUMENTS; "
                  "$s.Description=$env:GATEWAY_MARKER; $s.WindowStyle=7; $s.Save()")
    else:
        if not shortcut.exists():
            raise FileNotFoundError(f"Startup shortcut does not exist: {shortcut}")
        script = ("$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($env:GATEWAY_SHORTCUT); "
                  "if ($s.Description -ne $env:GATEWAY_MARKER) { throw 'Shortcut is not owned by this gateway' }; "
                  "Remove-Item -LiteralPath $env:GATEWAY_SHORTCUT")
    subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], env=env, check=True)
    print(f"{action}: {shortcut}")


def main():
    parser = argparse.ArgumentParser(description="Authenticated local Telnet gateway")
    parser.add_argument("command", nargs="?", choices=("init", "token", "run", "install-startup", "uninstall-startup"), default="run")
    parser.add_argument("--origin", action="append", help="Allowed website origin (repeatable; init only)")
    args = parser.parse_args()
    if args.origin and args.command != "init":
        parser.error("--origin is only valid with init")
    path = config_dir() / "config.json"
    if args.command == "init":
        origins = [validate_origin(origin) for origin in (args.origin or [DEFAULT_ORIGIN])]
        path.parent.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        create_private_directory(path.parent)
        save_config(path, {"token": secrets.token_urlsafe(32), "origins": origins, "targets": []})
        print(f"Gateway initialized. Run the token command to view your private token. Configuration: {path}")
    elif args.command in ("install-startup", "uninstall-startup"):
        if args.command == "install-startup":
            load_config(path)
        startup(args.command)
    else:
        config = load_config(path)
        if args.command == "token":
            print(config["token"])
        else:
            logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
            asyncio.run(Gateway(path, config).run())


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Gateway error: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        pass
