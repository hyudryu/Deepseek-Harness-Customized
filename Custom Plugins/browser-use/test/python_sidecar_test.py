"""Keyless interactive protocol and vendor lifecycle regression tests."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SIDECAR = Path(__file__).resolve().parents[1] / 'python' / 'sidecar.py'
spec = importlib.util.spec_from_file_location('sidecar', SIDECAR)
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)


class FakeSession:
    def __init__(self, **options):
        self.options = options
        self.cdp_url = options.get('cdp_url')
        self.closed = None
        self.started = 0

    async def start(self):
        self.started += 1
        self.cdp_url = 'ws://assigned-after-start'

    async def stop(self):
        self.closed = 'disconnected'

    async def kill(self):
        self.closed = 'killed'

    async def take_screenshot(self, **kwargs):
        if self.closed:
            raise RuntimeError('session closed before supervision screenshot')

    async def get_tabs(self):
        return []


class FakeAction:
    def __init__(self, name):
        self.name = name

    def model_dump(self, **kwargs):
        return {self.name: {}}


class FakeHistory:
    def __init__(self):
        self.history = [SimpleNamespace(model_output=SimpleNamespace(action=[
            FakeAction('navigate'), FakeAction('extract'), FakeAction('unexecuted')]),
            result=[SimpleNamespace(extracted_content=None), SimpleNamespace(extracted_content='page text')])]

    def urls(self): return []
    def is_done(self): return False
    def final_result(self): return None
    def errors(self): return []


class FakeAgent:
    def __init__(self, browser_session, **kwargs):
        self.session = browser_session
        self.task = kwargs['task']

    async def run(self, **kwargs):
        if self.task == 'block':
            sidecar.emit({'event': 'running'})
            await asyncio.Event().wait()
        if not self.session.options.get('keep_alive'):
            await self.session.kill()
        return FakeHistory()


def prepare(instance):
    instance.session_cls = FakeSession
    instance.agent_cls = FakeAgent
    instance.chat_cls = lambda **kwargs: kwargs


class SidecarTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_default_and_explicit_override(self):
        with patch.dict(os.environ, {'DSH_BU_API_KEY': 'test-key'}, clear=True):
            instance = sidecar.Sidecar()
            instance.chat_cls = lambda base_url='https://api.deepseek.com/v1', **kwargs: base_url
            self.assertEqual(instance.build_llm(), 'https://api.deepseek.com/v1')
            os.environ['DSH_BU_LLM_BASE_URL'] = 'https://custom.invalid/v1'
            self.assertEqual(instance.build_llm(), 'https://custom.invalid/v1')

    async def test_incomplete_history_stays_paired_and_session_reused(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {
            'DSH_BU_API_KEY': 'test-key', 'DSH_BU_ARTIFACT_DIR': root,
        }, clear=True):
            instance = sidecar.Sidecar()
            prepare(instance)
            result = await instance.handle_run({'task': 'first'})
            self.assertNotIn('final_result', result)
            self.assertNotIn('url', result)
            self.assertEqual(result['steps'], [
                {'step': 1, 'action': 'navigate', 'result': ''},
                {'step': 2, 'action': 'extract', 'result': 'page text'},
            ])
            self.assertIn('screenshot_path', result)
            session = instance.session
            await instance.handle_run({'task': 'second'})
            self.assertIs(session, instance.session)
            self.assertEqual(session.started, 1)
            self.assertEqual(set(await instance.handle_screenshot({})), {'screenshot_path'})
            await instance.shutdown()
            self.assertEqual(session.closed, 'killed')

    async def test_attached_browser_disconnects_without_kill(self):
        with patch.dict(os.environ, {'DSH_BU_CDP_URL': 'ws://external'}, clear=True):
            instance = sidecar.Sidecar()
            prepare(instance)
            session = await instance.browser_session()
            self.assertTrue(session.options['keep_alive'])
            await instance.shutdown()
            self.assertEqual(session.closed, 'disconnected')


class InteractiveTests(unittest.TestCase):
    def test_live_stdin_ping_exclusive_run_and_stop(self):
        with tempfile.TemporaryDirectory() as root:
            env = {**os.environ, 'DSH_BU_API_KEY': 'test-key', 'DSH_BU_ARTIFACT_DIR': root}
            child = subprocess.Popen([sys.executable, '-u', str(Path(__file__).resolve()), '--fixture'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
            replies = queue.Queue()
            def read():
                for line in child.stdout:
                    replies.put(json.loads(line))
            reader = threading.Thread(target=read)
            reader.start()
            def send(request_id, method, **params):
                child.stdin.write(json.dumps({'id': request_id, 'method': method, 'params': params}) + '\n')
                child.stdin.flush()
            try:
                send(1, 'ping')
                self.assertEqual(replies.get(timeout=30)['id'], 1)
                self.assertIsNone(child.poll())
                send(2, 'run', task='block')
                self.assertEqual(replies.get(timeout=30), {'event': 'running'})
                send(3, 'run', task='second')
                second = replies.get(timeout=30)
                self.assertEqual(second['id'], 3)
                self.assertFalse(second['ok'])
                send(4, 'stop')
                stopped = [replies.get(timeout=30), replies.get(timeout=30)]
                self.assertEqual({reply['id'] for reply in stopped}, {2, 4})
                self.assertTrue(all(reply['result']['stopped'] for reply in stopped))
                send(5, 'run', task='resumed')
                self.assertEqual(replies.get(timeout=30)['id'], 5)
                child.stdin.close()
                self.assertEqual(child.wait(timeout=30), 0, child.stderr.read())
            finally:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=30)
                reader.join(timeout=30)
                self.assertFalse(reader.is_alive())
                for stream in (child.stdin, child.stdout, child.stderr):
                    stream.close()


if __name__ == '__main__':
    if '--fixture' in sys.argv:
        async def start(self):
            prepare(self)
            self.version = 'test'
        sidecar.Sidecar.start = start
        sidecar.main()
    else:
        unittest.main()
