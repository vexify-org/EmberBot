# EmberBot 插件宿主（Python sidecar）
#
# 职责：
# 1. 加载 plugins/ 目录下的 AstrBot 插件（metadata.yaml + main.py，继承 Star）
# 2. 通过 stdin/stdout 上的 JSON Lines 协议与 Node 主进程通信
# 3. 将用户消息分发到匹配的插件 handler，收集回复
#
# 协议：
#   Node -> Py: {"id": "...", "type": "chat", "text": "...", "sender": {...}}
#   Py -> Node: {"type": "ready", "plugins": [...]}
#               {"type": "log", "level": "info", "msg": "..."}
#               {"type": "response", "id": "...", "ok": true, "result": {...}}
#               {"type": "response", "id": "...", "ok": false, "error": "..."}

import sys
import os
import json
import re
import asyncio
import inspect
import traceback
import importlib.util
import logging

# 让插件可以 import astrbot.*
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from astrbot.api.star import Context, Star  # noqa: E402
from astrbot.api import logger  # noqa: E402
from astrbot.api.event import (  # noqa: E402
    AstrMessageEvent,
    AstrBotMessage,
    MessageEventResult,
    MessageType,
    Plain,
)

# ---- 日志转发到 Node ----


class _NodeLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            emit(
                {
                    "type": "log",
                    "level": record.levelname.lower(),
                    "msg": record.getMessage(),
                }
            )
        except Exception:
            pass


logger.addHandler(_NodeLogHandler())
logger.setLevel(logging.INFO)
logger.propagate = False


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ---- 插件加载 ----


class LoadedPlugin:
    def __init__(self, instance: Star, handlers: list, meta: dict):
        self.instance = instance
        self.handlers = handlers  # [(method, filter_info)]
        self.meta = meta

    @property
    def name(self) -> str:
        return self.meta.get("name", self.instance.__class__.__name__)


def _discover_handlers(instance: Star) -> list:
    """收集插件实例上带 __ember_filter__ 的方法"""
    handlers = []
    seen = set()
    for cls in reversed(type(instance).__mro__):
        for attr_name, attr in vars(cls).items():
            if attr_name in seen:
                continue
            if callable(attr) and hasattr(attr, "__ember_filter__"):
                handlers.append((attr, getattr(attr, "__ember_filter__")))
                seen.add(attr_name)
    # 指令优先：带名字的排前面，优先级高者优先
    handlers.sort(key=lambda x: -(x[1].get("priority", 0)))
    return handlers


def load_plugins(plugins_dir: str) -> list[LoadedPlugin]:
    plugins: list[LoadedPlugin] = []
    if not os.path.isdir(plugins_dir):
        emit({"type": "log", "level": "warning", "msg": f"插件目录不存在: {plugins_dir}"})
        return plugins

    for entry in sorted(os.listdir(plugins_dir)):
        plugin_dir = os.path.join(plugins_dir, entry)
        main_py = os.path.join(plugin_dir, "main.py")
        if not (os.path.isdir(plugin_dir) and os.path.isfile(main_py)):
            continue
        if not os.path.isfile(os.path.join(plugin_dir, "metadata.yaml")):
            emit(
                {
                    "type": "log",
                    "level": "warning",
                    "msg": f"跳过 {entry}: 缺少 metadata.yaml",
                }
            )
            continue

        module_name = f"ember_plugin_{entry}"
        try:
            spec = importlib.util.spec_from_file_location(module_name, main_py)
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
        except Exception:
            emit(
                {
                    "type": "log",
                    "level": "error",
                    "msg": f"插件 {entry} 导入失败:\n{traceback.format_exc()}",
                }
            )
            continue

        # 找到本模块中 @register 过的 Star 子类并实例化
        for obj in vars(module).values():
            if (
                inspect.isclass(obj)
                and issubclass(obj, Star)
                and obj is not Star
                and getattr(obj, "__module__", None) == module_name
                and hasattr(obj, "__ember_meta__")
            ):
                try:
                    instance = obj(Context())
                    handlers = _discover_handlers(instance)
                    plugins.append(LoadedPlugin(instance, handlers, obj.__ember_meta__))
                    emit(
                        {
                            "type": "log",
                            "level": "info",
                            "msg": f"已加载插件 {obj.__ember_meta__['name']} v{obj.__ember_meta__['version']}（{len(handlers)} 个 handler）",
                        }
                    )
                except Exception:
                    emit(
                        {
                            "type": "log",
                            "level": "error",
                            "msg": f"插件 {entry} 实例化失败:\n{traceback.format_exc()}",
                        }
                    )
    return plugins


# ---- 消息分发 ----


def _match_command(text: str, f: dict) -> bool:
    """指令匹配：支持 /name args、name args、以及别名"""
    stripped = text.lstrip("/")
    names = {f["name"], *f.get("alias", set())}
    tokens = stripped.split(maxsplit=1)
    if not tokens:
        return False
    first = tokens[0]
    return first in names or stripped in names


def _collect_result(out: list, item) -> None:
    """收集 handler 产出：MessageEventResult / str / None"""
    if item is None:
        return
    if isinstance(item, MessageEventResult):
        out.append(item)
    elif isinstance(item, str):
        out.append(MessageEventResult([Plain(item)]))
    else:
        emit({"type": "log", "level": "warning", "msg": f"忽略无法识别的 handler 产出类型: {type(item)}"})


async def _invoke_handler(instance, method, event: AstrMessageEvent, out: list) -> None:
    ret = method(instance, event)
    if ret is None:
        return
    if inspect.isasyncgen(ret):
        async for item in ret:
            _collect_result(out, item)
    elif inspect.iscoroutine(ret):
        _collect_result(out, await ret)
    elif inspect.isgenerator(ret):
        for item in ret:
            _collect_result(out, item)
    else:
        _collect_result(out, ret)


async def handle_chat(plugins: list[LoadedPlugin], payload: dict) -> dict:
    text = (payload.get("text") or "").strip()
    sender = payload.get("sender") or {}
    sender_id = str(sender.get("id", "") or "user")
    sender_name = str(sender.get("name", "") or sender_id)
    session_id = str(payload.get("session_id", "") or f"ember:{sender_id}")

    msg = AstrBotMessage(
        message_str=text,
        message=[Plain(text)],
        sender={"user_id": sender_id, "nickname": sender_name},
        session_id=session_id,
        self_id="emberbot",
        raw_message=text,
    )
    msg.type = MessageType.FRIEND_MESSAGE
    event = AstrMessageEvent(
        message_str=text,
        message_obj=msg,
        sender_id=sender_id,
        sender_name=sender_name,
        session_id=session_id,
    )

    results: list[MessageEventResult] = []
    matched_plugins: list[str] = []

    for plugin in plugins:
        for method, f in plugin.handlers:
            kind = f.get("kind")
            matched = False
            if kind == "command":
                matched = _match_command(text, f)
            elif kind == "regex":
                matched = bool(f["pattern"].search(text))
            elif kind == "event_message_type":
                from astrbot.api.event import EventMessageType

                value = f.get("value")
                matched = value in (EventMessageType.ALL, None)
            # lifecycle / platform_adapter_type 等暂不触发

            if not matched:
                continue

            try:
                await _invoke_handler(plugin.instance, method, event, results)
            except Exception:
                emit(
                    {
                        "type": "log",
                        "level": "error",
                        "msg": f"插件 {plugin.name} handler {method.__name__} 执行出错:\n{traceback.format_exc()}",
                    }
                )
                continue

            if plugin.name not in matched_plugins:
                matched_plugins.append(plugin.name)
            if event.is_event_stopped():
                break
        if event.is_event_stopped():
            break

    # 合并所有结果（handler yield 的 + event.send() 的）
    parts = [r.get_plain_text() for r in results]
    parts += [r.get_plain_text() for r in event.outputs]
    reply = "\n".join(p for p in parts if p.strip())

    return {
        "matched": len(matched_plugins) > 0,
        "reply": reply,
        "plugin": ", ".join(matched_plugins),
    }


# ---- 主循环 ----


def main() -> None:
    plugins_dir = (
        sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "plugins")
    )
    plugins = load_plugins(plugins_dir)

    emit(
        {
            "type": "ready",
            "plugins": [
                {
                    "name": p.meta.get("name"),
                    "author": p.meta.get("author"),
                    "desc": p.meta.get("desc"),
                    "version": p.meta.get("version"),
                    "handlers": [m.__name__ for m, _ in p.handlers],
                }
                for p in plugins
            ],
        }
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            emit({"type": "log", "level": "error", "msg": f"无法解析请求: {line[:200]}"})
            continue

        req_id = req.get("id")
        try:
            result = asyncio.run(handle_chat(plugins, req))
            emit({"type": "response", "id": req_id, "ok": True, "result": result})
        except Exception:
            emit(
                {
                    "type": "response",
                    "id": req_id,
                    "ok": False,
                    "error": traceback.format_exc(limit=5),
                }
            )


if __name__ == "__main__":
    main()
