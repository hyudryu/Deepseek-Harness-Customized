#!/usr/bin/env python3
"""DSH browser-use sidecar: newline-delimited JSON-RPC on stdio.

The host plugin spawns one sidecar per DSH session. Every stdin line is a
request ``{"id", "method", "params"}``; every reply is one stdout line
``{"id", "ok", "result"|"error"}``. Progress arrives as ``{"event": ...}``
lines. The sidecar exits when stdin closes.

Methods:

- ``ping``: readiness probe; replies with the installed browser-use version.
- ``run``: params ``{task, max_steps?, use_vision?}``; drives the browser-use
  Agent against the session browser and replies with a run summary whose
  ``screenshot_path`` is the harness-side supervision input.
- ``screenshot``: params ``{path?, full_page?}``; saves a capture of the
  current tab.
- ``stop``: cancels the active ``run``.

Environment (set by the host; ``DSH_BU_API_KEY`` is never logged):

===========================  ==================================================
``DSH_BU_CDP_URL``           CDP endpoint of the integrated Chrome; empty means
                             browser-use launches its own local browser
``DSH_BU_HEADLESS``          ``true``/``false`` for the self-launched browser
``DSH_BU_ARTIFACT_DIR``      absolute directory for screenshots
``DSH_BU_LLM_PROVIDER``      ``deepseek`` (default) or ``openai``
``DSH_BU_LLM_MODEL``         model id passed to the chat client
``DSH_BU_LLM_BASE_URL``      optional base URL override
``DSH_BU_API_KEY``           API key for the chat client
``DSH_BU_MAX_HISTORY_CHARS`` cap for ``final_result`` text in run replies
``DSH_BU_MAX_STEPS``         default step budget when a request omits it
===========================  ==================================================
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

MAX_STEP_CHARS = 400
MAX_ERRORS = 10
SHORT_TIMEOUT_S = 60.0
# After stdin closes, in-flight requests get this long to finish before shutdown.
EOF_GRACE_S = 60.0


class ProtocolError(Exception):
	"""A request the sidecar refuses; the message is delivered to the model."""


def emit(value: dict[str, Any]) -> None:
	sys.stdout.write(json.dumps(value, ensure_ascii=False) + '\n')
	sys.stdout.flush()


def clip(text: str | None, limit: int) -> str:
	text = text or ''
	if len(text) <= limit:
		return text
	return text[:limit] + '\n…[truncated]'


class Sidecar:
	"""One long-lived browser-use BrowserSession serving requests on demand."""

	def __init__(self) -> None:
		self.artifact_dir = Path(os.environ.get('DSH_BU_ARTIFACT_DIR') or '.')
		self.max_history_chars = int(os.environ.get('DSH_BU_MAX_HISTORY_CHARS') or 12_000)
		self.default_max_steps = int(os.environ.get('DSH_BU_MAX_STEPS') or 25)
		self.active_run: asyncio.Task[None] | None = None
		self.session: Any = None
		self.agent_cls: Any = None
		self.session_cls: Any = None
		self.chat_cls: Any = None
		self.version = 'unknown'
		self.attached_browser = bool(os.environ.get('DSH_BU_CDP_URL'))

	async def start(self) -> None:
		try:
			from importlib.metadata import version

			from browser_use import Agent, BrowserSession, ChatDeepSeek, ChatOpenAI

			self.version = version('browser-use')
		except Exception as error:
			emit({'event': 'fatal', 'message': f'browser-use import failed: {error}'})
			raise
		self.agent_cls = Agent
		self.session_cls = BrowserSession
		self.chat_cls = (
			ChatOpenAI if os.environ.get('DSH_BU_LLM_PROVIDER', 'deepseek').lower() == 'openai' else ChatDeepSeek
		)
		self.artifact_dir.mkdir(parents=True, exist_ok=True)

	def build_llm(self) -> Any:
		api_key = os.environ.get('DSH_BU_API_KEY') or None
		if not api_key:
			raise ProtocolError(
				'browser_use run requires an API key: set the env var named by the '
				'llmApiKeyEnv config (default DEEPSEEK_API_KEY) for the Harness process.'
			)
		options = {'model': os.environ.get('DSH_BU_LLM_MODEL') or 'deepseek-chat', 'api_key': api_key}
		if base_url := os.environ.get('DSH_BU_LLM_BASE_URL'):
			options['base_url'] = base_url
		return self.chat_cls(**options)

	async def browser_session(self) -> Any:
		if self.session is None:
			self.session = self.session_cls(
				cdp_url=os.environ.get('DSH_BU_CDP_URL') or None,
				headless=os.environ.get('DSH_BU_HEADLESS', '').lower() == 'true',
				keep_alive=True,
			)
			await self.session.start()
		return self.session

	async def handle_ping(self, _params: dict[str, Any]) -> dict[str, Any]:
		return {'version': self.version}

	async def handle_run(self, params: dict[str, Any]) -> dict[str, Any]:
		task = str(params.get('task') or '').strip()
		if not task:
			raise ProtocolError('run requires a nonempty task')
		try:
			max_steps = int(params.get('max_steps') or self.default_max_steps)
		except (TypeError, ValueError):
			raise ProtocolError('max_steps must be an integer') from None
		if max_steps <= 0:
			raise ProtocolError('max_steps must be a positive integer')

		llm = self.build_llm()
		session = await self.browser_session()
		agent = self.agent_cls(
			task=task,
			llm=llm,
			browser_session=session,
			use_vision=bool(params.get('use_vision')),
		)
		started = time.monotonic()
		history = await agent.run(max_steps=max_steps)
		elapsed_s = round(time.monotonic() - started, 1)

		screenshot_path = await self.save_screenshot()
		steps = []
		for item in history.history:
			if item.model_output is None:
				continue
			for action, result in zip(item.model_output.action, item.result):
				action_fields = action.model_dump(exclude_none=True, mode='json')
				steps.append({
					'step': len(steps) + 1,
					'action': next(iter(action_fields), ''),
					'result': clip(result.extracted_content if result else '', MAX_STEP_CHARS),
				})
		urls = [url for url in history.urls() if url]
		result = {
			'done': bool(history.is_done()),
			'errors': [str(error) for error in history.errors() if error][:MAX_ERRORS],
			'steps': steps[-max_steps:],
			'elapsed_s': elapsed_s,
			'screenshot_path': screenshot_path,
		}
		if final_result := history.final_result():
			result['final_result'] = clip(final_result, self.max_history_chars)
		if urls:
			result['url'] = urls[-1]
		return result

	async def save_screenshot(self, path: str | None = None, full_page: bool = True) -> str:
		session = await self.browser_session()
		target = Path(path) if path else self.artifact_dir / f'browser-use-{int(time.time() * 1000)}.png'
		target.parent.mkdir(parents=True, exist_ok=True)
		await session.take_screenshot(path=str(target), full_page=full_page)
		return str(target)

	async def handle_screenshot(self, params: dict[str, Any]) -> dict[str, Any]:
		if self.active_run is not None and not self.active_run.done():
			raise ProtocolError('a browser_use run is active; stop it before taking a screenshot')
		session = await self.browser_session()
		screenshot_path = await self.save_screenshot(
			path=params.get('path'),
			full_page=bool(params.get('full_page', True)),
		)
		tabs = await session.get_tabs()
		last = tabs[-1] if tabs else None
		result = {'screenshot_path': screenshot_path}
		if last is not None:
			if last.url is not None:
				result['url'] = last.url
			if last.title is not None:
				result['title'] = last.title
		return result

	async def handle_stop(self, _params: dict[str, Any]) -> dict[str, Any]:
		if self.active_run is None or self.active_run.done():
			return {'stopped': False}
		self.active_run.cancel()
		try:
			await self.active_run
		except BaseException:
			pass
		return {'stopped': True}

	async def shutdown(self) -> None:
		if self.active_run is not None and not self.active_run.done():
			self.active_run.cancel()
			try:
				await self.active_run
			except BaseException:
				pass
		# An attached Chrome and its tabs belong to the integrated browser and
		# survive; a browser this sidecar launched itself is closed.
		if self.session is not None:
			if self.attached_browser:
				await self.session.stop()
			else:
				await self.session.kill()


async def amain() -> None:
	sidecar = Sidecar()
	await sidecar.start()

	loop = asyncio.get_running_loop()
	requests: asyncio.Queue[str] = asyncio.Queue()

	def read_stdin() -> None:
		for line in sys.stdin:
			loop.call_soon_threadsafe(requests.put_nowait, line)
		loop.call_soon_threadsafe(requests.put_nowait, '')

	stdin_reader = loop.run_in_executor(None, read_stdin)

	handlers = {
		'ping': sidecar.handle_ping,
		'run': sidecar.handle_run,
		'screenshot': sidecar.handle_screenshot,
		'stop': sidecar.handle_stop,
	}
	inflight: set[asyncio.Task[None]] = set()

	while True:
		line = (await requests.get()).strip()
		if line == '':
			break
		try:
			request = json.loads(line)
			if not isinstance(request, dict):
				raise ValueError('request must be a JSON object')
		except ValueError as error:
			emit({'event': 'log', 'level': 'warn', 'message': f'unreadable request line ignored: {error}'})
			continue
		request_id = request.get('id')
		method = str(request.get('method') or '')
		params = request.get('params') or {}
		handler = handlers.get(method)
		if not isinstance(params, dict):
			emit({'id': request_id, 'ok': False, 'error': 'params must be a JSON object'})
			continue
		if handler is None:
			emit({'id': request_id, 'ok': False, 'error': f'unknown method: {method}'})
			continue

		if method == 'run' and sidecar.active_run is not None and not sidecar.active_run.done():
			emit({'id': request_id, 'ok': False, 'error': 'a browser_use run is already active'})
			continue

		async def dispatch(
			request_id=request_id,
			handler=handler,
			params=params,
			unbounded=method in ('run', 'stop'),
		) -> None:
			try:
				result = await asyncio.wait_for(handler(params), timeout=None if unbounded else SHORT_TIMEOUT_S)
				emit({'id': request_id, 'ok': True, 'result': result})
			except asyncio.CancelledError:
				emit({'id': request_id, 'ok': True, 'result': {'stopped': True}})
			except ProtocolError as error:
				emit({'id': request_id, 'ok': False, 'error': str(error)})
			except Exception as error:
				emit({'id': request_id, 'ok': False, 'error': f'{type(error).__name__}: {error}'})

		task = loop.create_task(dispatch())
		inflight.add(task)
		task.add_done_callback(inflight.discard)
		if method == 'run':
			sidecar.active_run = task

	# stdin closed: let in-flight requests reply within the grace window, then shut down.
	if inflight:
		await asyncio.wait(set(inflight), timeout=EOF_GRACE_S)
	await sidecar.shutdown()
	await stdin_reader


def main() -> None:
	try:
		asyncio.run(amain())
	except KeyboardInterrupt:
		pass


if __name__ == '__main__':
	main()
