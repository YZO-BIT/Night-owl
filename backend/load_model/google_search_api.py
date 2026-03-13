from tavily import TavilyClient
import os
from dotenv import load_dotenv

load_dotenv('/workspaces/Night-owl/backend/.env')
TV_KEY = os.getenv("TV_KEY")
try:
    tavily_client = TavilyClient(api_key=TV_KEY)
except Exception as e:
     print("Not loaded search engine")
print("Loaded search Engine")



