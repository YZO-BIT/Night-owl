import os
import openai
from langgraph.graph import StateGraph
from typing import TypedDict, Optional
from main import tvly, pc, model, index, generator  # Import initialized singletons from main

# Define state strictly as dict but with hints
class InterviewState(TypedDict):
    audio_path: Optional[str]
    transcript: str
    search_query: str
    search_results: str
    rag_context: str
    llm_response: str
    tts_audio_path: Optional[str]

# ================================
# NODES
# ================================

def stt_node(state: dict) -> dict:
    print("Executing STT...")
    # In a real scenario, we use OpenAI Whisper API to transcribe state["audio_path"]
    # Mocking STT to use a placeholder if audio is skipped
    transcript = state.get("transcript", "Mock transcribed text of user's voice.")
    return {"transcript": transcript}

def search_node(state: dict) -> dict:
    print("Executing Search...")
    transcript = state.get("transcript", "")
    try:
        # Search tavily based on transcript
        res = tvly.search(query=transcript + " interview best practices")
        results = str(res.get("results", []))
    except Exception as e:
        results = ""
    return {"search_results": results[:1000]}  # limit text length

def rag_node(state: dict) -> dict:
    print("Executing RAG...")
    transcript = state.get("transcript", "")
    try:
        vector = model.encode(transcript).tolist()
        results = index.query(vector=vector, top_k=2, include_metadata=True)
        context = " ".join([m["metadata"]["text"] for m in results["matches"]])
    except Exception:
        context = "No context found."
    return {"rag_context": context}

def llm_node(state: dict) -> dict:
    print("Executing LLM...")
    prompt = f"""You are a professional AI interviewer.
Context from search: {state.get('search_results', '')}
Context from knowledge base: {state.get('rag_context', '')}
User Transcript: {state.get('transcript', '')}
Please respond to the user professionally and concisely.
Response:"""
    
    try:
        output = generator(prompt, max_length=150, num_return_sequences=1)
        response = output[0]["generated_text"].replace(prompt, "").strip()
    except Exception:
        response = "I see. Could you elaborate slightly?"
    return {"llm_response": response}

def tts_node(state: dict) -> dict:
    print("Executing TTS...")
    response_text = state.get("llm_response", "Okay.")
    # Here, we'd use OpenAI TTS or Google TTS to write to a wav/mp3 file and return the path
    # For now, we simulate returning an encoded audio path
    return {"tts_audio_path": "/tmp/mock_tts_output.mp3"}

# ================================
# GRAPH COMPILATION
# ================================

def build_interview_graph():
    g = StateGraph(dict)

    g.add_node("stt", stt_node)
    g.add_node("search", search_node)
    g.add_node("rag", rag_node)
    g.add_node("llm", llm_node)
    g.add_node("tts", tts_node)

    g.set_entry_point("stt")

    g.add_edge("stt", "search")
    g.add_edge("search", "rag")
    g.add_edge("rag", "llm")
    g.add_edge("llm", "tts")
    
    g.set_finish_point("tts")

    return g.compile()

interview_graph = build_interview_graph()
