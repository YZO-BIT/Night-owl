from huggingface_hub import InferenceClient
from dotenv import load_dotenv
import os
load_dotenv('/workspaces/Night-owl/backend/.env')
HF_KEY=os.getenv('HF_KEY')
try:
    client_tg= InferenceClient(model="meta-llama/Meta-Llama-3-8B-Instruct", token=HF_KEY)
except Exception as e:
    print("Text_Generation Model not loaded")

print("Text_Generation model loaded successfully")

