# 兼容 astrbot.api.logger：插件的日志会经由 sidecar 转发到 Node 主进程输出
import logging

logger = logging.getLogger("astrbot")
logger.setLevel(logging.INFO)

__all__ = ["logger"]
