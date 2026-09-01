# 消息链组件（兼容 astrbot 消息组件子集）
from typing import Any


class Component:
    """消息组件基类"""

    type: str = "Component"

    def __init__(self, **kwargs: Any):
        for k, v in kwargs.items():
            setattr(self, k, v)

    def to_dict(self) -> dict:
        return {"type": self.type, **self.__dict__}

    def __repr__(self) -> str:
        return f"<{self.type} {self.to_dict()}>"


class Plain(Component):
    type = "Plain"

    def __init__(self, text: str = ""):
        self.text = text


class At(Component):
    type = "At"

    def __init__(self, qq: str = "", name: str = ""):
        self.qq = qq
        self.name = name


class Image(Component):
    type = "Image"

    def __init__(self, url: str = "", file: str = "", base64: str = ""):
        self.url = url
        self.file = file
        self.base64 = base64


class Record(Component):
    """语音"""

    type = "Record"

    def __init__(self, url: str = "", file: str = "", base64: str = ""):
        self.url = url
        self.file = file
        self.base64 = base64


class Video(Component):
    type = "Video"

    def __init__(self, url: str = "", file: str = ""):
        self.url = url
        self.file = file


class File(Component):
    type = "File"

    def __init__(self, name: str = "", url: str = "", file: str = ""):
        self.name = name
        self.url = url
        self.file = file


class Face(Component):
    type = "Face"

    def __init__(self, id: int = 0):
        self.id = id


class Reply(Component):
    type = "Reply"

    def __init__(self, id: str = "", chain: Any = None):
        self.id = id
        self.chain = chain or []


class Node(Component):
    """合并转发节点"""

    type = "Node"

    def __init__(self, id: str = "", content: Any = None, name: str = "", uin: str = ""):
        self.id = id
        self.content = content
        self.name = name
        self.uin = uin


class Poke(Component):
    type = "Poke"

    def __init__(self, qq: str = ""):
        self.qq = qq


class NodeStr:
    """兼容旧版 astrbot 的 NodeStr"""

    def __init__(self, content: str = "", name: str = "", uin: str = ""):
        self.content = content
        self.name = name
        self.uin = uin


class MessageChain:
    """消息链：chain 为组件列表"""

    def __init__(self, chain: list | None = None):
        self.chain = list(chain or [])

    def get_plain_text(self) -> str:
        return "".join(
            c.text for c in self.chain if isinstance(c, Plain)
        )

    def append(self, comp: Component) -> "MessageChain":
        self.chain.append(comp)
        return self


__all__ = [
    "Component", "Plain", "At", "Image", "Record", "Video", "File",
    "Face", "Reply", "Node", "Poke", "NodeStr", "MessageChain",
]
