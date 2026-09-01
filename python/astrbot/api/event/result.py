# 消息事件结果对象（兼容 astrbot MessageEventResult 子集）
from typing import Any
from .components import Plain, Image, At, Record, Video, File, Component


class MessageEventResult:
    """handler 产出/返回的回复结果。支持链式构造，也支持直接读 .chain。"""

    def __init__(self, chain: list | None = None, use_t2i: bool = False):
        self.chain: list[Component] = list(chain or [])
        self.use_t2i = use_t2i

    # ---- 链式构造 ----
    def append(self, comp: Component) -> "MessageEventResult":
        self.chain.append(comp)
        return self

    def plain(self, text: str) -> "MessageEventResult":
        return self.append(Plain(text))

    def image_url(self, url: str) -> "MessageEventResult":
        return self.append(Image(url=url))

    def image_path(self, path: str) -> "MessageEventResult":
        return self.append(Image(file=path))

    def at(self, qq: str, name: str = "") -> "MessageEventResult":
        return self.append(At(qq=qq, name=name))

    def record_url(self, url: str) -> "MessageEventResult":
        return self.append(Record(url=url))

    def video_url(self, url: str) -> "MessageEventResult":
        return self.append(Video(url=url))

    def file(self, name: str, url: str = "", path: str = "") -> "MessageEventResult":
        return self.append(File(name=name, url=url, file=path))

    # ---- 读取 ----
    def get_plain_text(self) -> str:
        return "".join(c.text for c in self.chain if isinstance(c, Plain))

    def has_image(self) -> bool:
        return any(isinstance(c, Image) for c in self.chain)

    def __str__(self) -> str:
        return self.get_plain_text()


__all__ = ["MessageEventResult"]
