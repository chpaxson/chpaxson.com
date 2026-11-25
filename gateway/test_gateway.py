import asyncio
import json
from pathlib import Path
import tempfile
import unittest

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed, InvalidStatus

from gateway import Gateway, TelnetDecoder, encode_telnet, load_config, save_config, validate_origin, validate_target


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "config.json"
        self.config = {"token": "test-token-" + "x" * 40, "origins": ["http://localhost:5173"], "targets": []}
        save_config(self.path, self.config)
        self.gateway = Gateway(self.path, self.config)
        self.server = await serve(self.gateway.handle, "127.0.0.1", 0, origins=self.config["origins"])
        self.url = f"ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        self.directory.cleanup()

    async def open(self, request, origin="http://localhost:5173"):
        ws = await connect(self.url, origin=origin)
        await ws.send(json.dumps(request))
        return ws

    async def test_authentication_and_origin_are_required(self):
        with self.assertRaises(InvalidStatus):
            await connect(self.url, origin="http://evil.example")
        for token in ("bad", "non-ascii-\u2603"):
            ws = await self.open({"type": "control", "token": token})
            with self.assertRaises(ConnectionClosed) as error:
                await ws.recv()
            self.assertEqual(error.exception.rcvd.code, 1008)
            await ws.close()
        self.assertEqual(load_config(self.path)["targets"], [])

    async def test_multiple_sessions_and_revoking_target(self):
        async def echo(reader, writer):
            writer.write(bytes([255, 251]))
            await writer.drain()
            await asyncio.sleep(0.01)
            writer.write(bytes([1]) + b"hello")
            await writer.drain()
            try:
                await reader.readexactly(3)
                while data := await reader.read(1024):
                    writer.write(data)
                    await writer.drain()
            except asyncio.IncompleteReadError:
                pass
            finally:
                writer.close()
                await writer.wait_closed()

        tcp = await asyncio.start_server(echo, "127.0.0.1", 0)
        tcp2 = await asyncio.start_server(echo, "127.0.0.1", 0)
        target = {"host": "127.0.0.1", "port": tcp.sockets[0].getsockname()[1]}
        target2 = {"host": "127.0.0.1", "port": tcp2.sockets[0].getsockname()[1]}
        token = self.config["token"]
        control = await self.open({"type": "control", "token": token})
        self.assertEqual(json.loads(await control.recv())["targets"], [])
        denied = await self.open({"type": "connect", "token": token, **target})
        with self.assertRaises(ConnectionClosed):
            await denied.recv()
        await control.send(json.dumps({"type": "add", **target}))
        self.assertEqual(json.loads(await control.recv())["targets"], [target])
        self.assertEqual(load_config(self.path)["targets"], [target])
        await control.send(json.dumps({"type": "add", **target2}))
        self.assertEqual(json.loads(await control.recv())["targets"], [target, target2])
        clients = []
        try:
            for destination in (target, target2):
                client = await self.open({"type": "connect", "token": token, **destination})
                self.assertEqual(json.loads(await client.recv()), {"type": "ready"})
                self.assertEqual(await client.recv(), b"hello")
                clients.append(client)
            await clients[0].send(b"abc")
            self.assertEqual(await clients[0].recv(), b"abc")
            await control.send(json.dumps({"type": "remove", **target}))
            with self.assertRaises(ConnectionClosed) as error:
                await clients[0].recv()
            self.assertEqual(error.exception.rcvd.code, 1008)
            self.assertEqual(json.loads(await control.recv())["targets"], [target2])
            await clients[1].send(b"xyz")
            self.assertEqual(await clients[1].recv(), b"xyz")
            await control.send(json.dumps({"type": "remove", **target2}))
            with self.assertRaises(ConnectionClosed):
                await clients[1].recv()
            self.assertEqual(json.loads(await control.recv())["targets"], [])
            self.assertEqual(load_config(self.path)["targets"], [])
        finally:
            await asyncio.gather(*(client.close() for client in clients))
            await control.close()
            tcp.close()
            tcp2.close()
            await tcp.wait_closed()
            await tcp2.wait_closed()


class TelnetTests(unittest.TestCase):
    def test_fragmented_negotiation_and_escaped_data(self):
        decoder = TelnetDecoder()
        self.assertEqual(decoder.push(bytes([65, 255])), (b"A", b""))
        self.assertEqual(decoder.push(bytes([251, 1, 255, 253, 3, 255, 250, 1, 255])),
                         (b"", bytes([255, 254, 1, 255, 252, 3])))
        self.assertEqual(decoder.push(bytes([240, 66, 255, 255])), (bytes([66, 255]), b""))
        self.assertEqual(encode_telnet(bytes([65, 255, 66])), bytes([65, 255, 255, 66]))

    def test_target_validation(self):
        self.assertEqual(validate_target("[::1]", 23), {"host": "[::1]", "port": 23})
        for host, port in [("bad/host", 23), ("host", True), ("host", 65536), ("::1", 23)]:
            with self.assertRaises(ValueError):
                validate_target(host, port)

    def test_invalid_origin_and_configuration(self):
        for origin in (None, "http://localhost:0", "http://example.com"):
            with self.assertRaises(ValueError):
                validate_origin(origin)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            for origins, targets in [([None], []), (["https://example.com"], [{}])]:
                path.write_text(json.dumps({"token": "x" * 40, "origins": origins, "targets": targets}))
                with self.assertRaises(ValueError):
                    load_config(path)


if __name__ == "__main__":
    unittest.main()
