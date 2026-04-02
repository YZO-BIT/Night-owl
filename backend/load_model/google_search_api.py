from tavily import TavilyClient
import os
from dotenv import load_dotenv


try:
    tavily_client = TavilyClient(api_key='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')
except Exception as e:
     print("Not loaded search engine")
print("Loaded search Engine")



