# 插件上下文（兼容 astrbot Context 子集）
from typing import Any, Optional


class Context:
    """
    插件与宿主交互的上下文。
    EmberBot 宿主仅实现主动发消息等少量能力，其余 API 调用时给出明确报错。
    """

    def __init__(self, send_message_fn: Any = None):
        self._send_message_fn = send_message_fn

    async def send_message(self, unified_msg_origin: str, data: Any) -> Any:
        """主动发送消息（需宿主支持时才生效）"""
        if self._send_message_fn is not None:
            return await self._send_message_fn(unified_msg_origin, data)
        raise NotImplementedError(
            "EmberBot 兼容层暂不支持 context.send_message 主动消息"
        )

    def get_config(self, *args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError("EmberBot 兼容层暂不支持 context.get_config")

    def get_registered_star(self, *args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError("EmberBot 兼容层暂不支持 context.get_registered_star")

    def get_all_stars(self, *args: Any, **kwargs: Any) -> list:
        raise NotImplementedError("EmberBot 兼容层暂不支持 context.get_all_stars")

    def on_star_loaded(self, *args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError("EmberBot 兼容层暂不支持 context.on_star_loaded")

    def get_config_dir(self) -> str:
        return "data"

    def get_db(self, *args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError("EmberBot 兼容层暂不支持 context.get_db")

    async def llm_query(self, *args: Any, **kwargs: Any) -> Optional[str]:
        raise NotImplementedError("EmberBot 兼容层暂不支持 context.llm_query")


__all__ = ["Context"]
