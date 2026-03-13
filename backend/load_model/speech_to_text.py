from state_definition.state import State
import sounddevice as sd
async def stt_node(states:State):
    async with websockets.connect("ws://localhost:8998") as ws:
        await ws.send(states['audio_input'])
        res=ws.recv()
        data=json.load(res)
        print(res)

audio = sd.rec(int(5 * 16000), samplerate=16000, channels=1, dtype='int16')
sd.wait()

states=State()
states['audio']=audio
stt_node(states)

