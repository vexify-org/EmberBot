# handler 过滤器装饰器（兼容 astrbot.api.event.filter 子集）
from typing import Any, Callable

from .event import EventMessageType


def _set_filter(fn: Callable, info: dict) -> Callable:
    setattr(fn, "__ember_filter__", info)
    return fn


def command(name: str, *, alias: set | list | None = None, priority: int = 0) -> Callable:
    """指令过滤器：消息以 /name（或 name）开头时触发"""
    aliases = set(alias or [])

    def deco(fn: Callable) -> Callable:
        return _set_filter(
            fn, {"kind": "command", "name": name, "alias": aliases, "priority": priority}
        )

    return deco


class _CommandGroup:
    """指令组：@group.command("x") 等价于指令 "组名 x" """

    def __init__(self, group_name: str):
        self.group_name = group_name

    def command(self, name: str, *, alias: set | list | None = None, priority: int = 0) -> Callable:
        full = f"{self.group_name} {name}"
        return command(full, alias=alias, priority=priority)


def command_group(group_name: str) -> _CommandGroup:
    return _CommandGroup(group_name)


def regex(pattern: str) -> Callable:
    """正则过滤器：消息内容匹配正则时触发"""
    import re

    compiled = re.compile(pattern)

    def deco(fn: Callable) -> Callable:
        return _set_filter(fn, {"kind": "regex", "pattern": compiled, "raw": pattern})

    return deco


def event_message_type(event_type: EventMessageType) -> Callable:
    """事件类型过滤器"""
    def deco(fn: Callable) -> Callable:
        return _set_filter(fn, {"kind": "event_message_type", "value": event_type})

    return deco


def platform_adapter_type(adapter_type: str) -> Callable:
    """平台适配器过滤器（EmberBot 下恒为 emberbot）"""
    def deco(fn: Callable) -> Callable:
        return _set_filter(fn, {"kind": "platform_adapter_type", "value": adapter_type})

    return deco


# ---- 生命周期钩子：EmberBot 宿主不触发这些阶段，装饰器仅做标记保证可导入 ----
def _noop_lifecycle(*_args: Any, **_kwargs: Any) -> Callable:
    def deco(fn: Callable) -> Callable:
        return _set_filter(fn, {"kind": "lifecycle", "value": None})

    return deco


on_llm_request = _noop_lifecycle
on_llm_response = _noop_lifecycle
on_decorating_result = _noop_lifecycle
after_message_sent = _noop_lifecycle
on_astrbot_loaded = _noop_lifecycle
permission_type = _noop_lifecycle


__all__ = [
    "command",
    "command_group",
    "regex",
    "event_message_type",
    "platform_adapter_type",
    "on_llm_request",
    "on_llm_response",
    "on_decorating_result",
    "after_message_sent",
    "on_astrbot_loaded",
    "permission_type",
]
