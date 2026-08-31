# Star 插件基类与 @register 装饰器（兼容 astrbot.api.star 子集）
from typing import Any

_REGISTERED_CLASSES: list[type] = []


def register(
    name: str, author: str, desc: str, version: str, repo: str = "?"
) -> Any:
    """类装饰器：标记一个 Star 插件类，宿主加载模块后据此实例化插件"""

    def deco(cls: type) -> type:
        cls.__ember_meta__ = {
            "name": name,
            "author": author,
            "desc": desc,
            "version": version,
            "repo": repo,
        }
        if cls not in _REGISTERED_CLASSES:
            _REGISTERED_CLASSES.append(cls)
        return cls

    return deco


class Star:
    """AstrBot 插件基类。插件继承此类并通过 @register 注册。"""

    def __init__(self, context: Any):
        self.context = context

    @property
    def name(self) -> str:
        meta = getattr(self.__class__, "__ember_meta__", {})
        return meta.get("name", self.__class__.__name__)

    def __str__(self) -> str:
        return f"<Star {self.name}>"

    async def terminate(self) -> None:
        """插件卸载/停用时调用，可选实现"""
        pass

    async def initialize(self) -> None:
        """插件加载完成后调用，可选实现"""
        pass


__all__ = ["Star", "register"]
