# 消息事件与事件对象（兼容 astrbot 子集）
from enum import Enum
from typing import Any, Optional

from .components import Plain, Component
from .result import MessageEventResult


class MessageType(Enum):
    GROUP_MESSAGE = "GroupMessage"
    FRIEND_MESSAGE = "FriendMessage"
    OTHER = "OTHER"


class EventMessageType(Enum):
    """事件类型过滤（filter.event_message_type 使用）"""

    ALL = (0,)
    GROUP_MESSAGE = (1,)
    PRIVATE_MESSAGE = (2,)


class AstrBotMessage:
    """消息对象：存储平台下发的原始消息信息"""

    def __init__(self, **kwargs: Any):
        self.type: MessageType = MessageType.OTHER
        self.self_id: str = ""
        self.session_id: str = ""
        self.message_id: str = ""
        self.sender: dict = {}
        self.message: list[Component] = []
        self.message_str: str = ""
        self.raw_message: Any = None
        self.group_id: Optional[str] = None
        for k, v in kwargs.items():
            setattr(self, k, v)


class AstrMessageEvent:
    """
    消息事件对象。
    EmberBot 宿主在每轮对话时构造此对象并传给插件 handler。
    """

    def __init__(
        self,
        message_str: str,
        message_obj: AstrBotMessage,
        sender_id: str = "",
        sender_name: str = "",
        session_id: str = "",
    ):
        self.message_str: str = message_str
        self.message_obj: AstrBotMessage = message_obj
        self.sender_id = sender_id
        self.sender_name = sender_name
        self.session_id = session_id or sender_id
        self.platform_name = "emberbot"
        self._extra: dict = {}
        self._stopped = False
        self.is_stopped = False
        # 宿主收集的输出（event.send() 的结果也进这里）
        self.outputs: list[MessageEventResult] = []

    # ---- 发送者信息 ----
    def get_sender_name(self) -> str:
        return self.sender_name or self.message_obj.sender.get("nickname", "")

    def get_sender_id(self) -> str:
        return self.sender_id or str(self.message_obj.sender.get("user_id", ""))

    def get_group_id(self) -> Optional[str]:
        return self.message_obj.group_id

    def get_session_id(self) -> str:
        return self.session_id or self.message_obj.session_id

    def is_private(self) -> bool:
        return self.message_obj.type == MessageType.FRIEND_MESSAGE

    def is_group(self) -> bool:
        return self.message_obj.type == MessageType.GROUP_MESSAGE

    def is_at_or_wake(self) -> bool:
        # EmberBot 场景下消息一定是定向发给 bot 的
        return True

    # ---- 构造回复 ----
    def plain_result(self, text: str) -> MessageEventResult:
        return MessageEventResult([Plain(text)])

    def image_result(
        self, url: str = "", path: str = "", disable_preview: bool = False
    ) -> MessageEventResult:
        return MessageEventResult([Image(url=url, file=path)])

    def make_result(self) -> MessageEventResult:
        return MessageEventResult()

    def chain_result(self, chain: list[Component]) -> MessageEventResult:
        return MessageEventResult(chain)

    async def send(self, result: MessageEventResult) -> None:
        """主动发送：结果会被宿主收集并合并进最终回复"""
        if result is not None:
            self.outputs.append(result)

    # ---- 事件控制 ----
    def stop_event(self) -> None:
        self._stopped = True
        self.is_stopped = True

    def is_event_stopped(self) -> bool:
        return self._stopped

    # ---- 扩展数据 ----
    def set_extra(self, key: str, value: Any) -> None:
        self._extra[key] = value

    def get_extra(self, key: str = "", default: Any = None) -> Any:
        if not key:
            return self._extra
        return self._extra.get(key, default)

    @property
    def unified_msg_origin(self) -> str:
        return f"emberbot:group:{self.session_id}"

    @property
    def role(self) -> str:
        return "ember"


__all__ = [
    "MessageType",
    "EventMessageType",
    "AstrBotMessage",
    "AstrMessageEvent",
]
