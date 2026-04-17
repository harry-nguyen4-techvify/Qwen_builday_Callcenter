"""
Simple voice agent for testing LiveKit connectivity.
No flow/spec required - just greets and responds.
"""
from livekit.agents import Agent

VIETNAMESE_GREETING = """Xin chao. Toi la tro ly ao cua ban.
Toi co the giup gi cho ban hom nay?"""

SYSTEM_PROMPT = """Ban la mot tro ly ao than thien va huu ich.
Ban noi tieng Viet tu nhien va than thien.
Tra loi ngan gon, ro rang.
Neu nguoi dung hoi ve dich vu ngan hang, hay gioi thieu so luoc.
Neu nguoi dung muon ket thuc cuoc goi, hay chao tam biet lich su."""


class SimpleAgent(Agent):
    """Minimal voice agent for testing."""

    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)

    async def on_enter(self) -> None:
        """Greet user when call starts."""
        await self.session.generate_reply(
            instructions=f"Say this greeting: {VIETNAMESE_GREETING}"
        )
