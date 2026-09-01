from astrbot.api.event import filter, AstrMessageEvent
from astrbot.api.star import Context, Star, register
from astrbot.api import logger


@register("helloworld", "EmberBot", "一个简单的 Hello World 插件", "1.0.0")
class MyPlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)

    @filter.command("helloworld")
    async def helloworld(self, event: AstrMessageEvent):
        """这是一个 hello world 指令"""
        user_name = event.get_sender_name()
        message_str = event.message_str
        logger.info("触发hello world指令!")
        yield event.plain_result(f"Hello, {user_name}!")

    @filter.command("echo")
    async def echo(self, event: AstrMessageEvent):
        """原样复述消息"""
        yield event.plain_result(f"Echo: {event.message_str}")

    @filter.regex(r"^\s*(?:你好|hello|hi)")
    async def greet(self, event: AstrMessageEvent):
        """问候语回应"""
        yield event.plain_result("你好！我是 EmberBot，很高兴见到你。")

    async def terminate(self):
        pass
