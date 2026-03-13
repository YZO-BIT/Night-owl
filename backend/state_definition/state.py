from typing_extensions import TypedDict
from langgraph.graph.message import add_messages
from typing_extensions import Annotated
class State(TypedDict):
    messages: Annotated[list,add_messages]
    audio_input: bytes
    transcription: str
    tts_audio: bytes   