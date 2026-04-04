from langgraph.graph import StateGraph
from typing import TypedDict, Optional
from main import tvly, index, _embed_text, generate_chat  # Import initialized singletons from main

# Define state strictly as dict but with hints
class InterviewState(TypedDict):
    audio_path: Optional[str]
    transcript: str
    search_query: str
    search_results: str
    rag_context: str
    llm_response: str
    critique: str
    revision_count: int
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
        vector = _embed_text(str(transcript))
        results = index.query(vector=vector, top_k=2, include_metadata=True)
        context = " ".join([m["metadata"]["text"] for m in results["matches"]])
    except Exception:
        context = "No context found."
    return {"rag_context": context}

def llm_node(state: dict) -> dict:
    print("Executing LLM...")
    critique = (state.get("critique") or "").strip()

    system_prompt = (
        "You are a professional AI interviewer. "
        "Ground every claim in the provided context only. "
        "If verifier feedback is provided, correct your response to address it exactly."
    )
    user_prompt = (
        f"Context from search: {state.get('search_results', '')}\n"
        f"Context from knowledge base: {state.get('rag_context', '')}\n"
        f"User transcript: {state.get('transcript', '')}\n"
        f"Verifier critique: {critique or 'None'}\n\n"
        "Task: Provide a concise, professional response strictly supported by the context."
    )

    try:
        response = generate_chat(system_prompt, user_prompt, 180).strip()
    except Exception:
        response = "I see. Could you elaborate slightly?"
    return {"llm_response": response}


def critic_node(state: dict) -> dict:
    print("Executing Critic (Verification)...")
    response = (state.get("llm_response") or "").strip()
    context = ((state.get("rag_context") or "") + "\n" + (state.get("search_results") or "")).strip()

    system_prompt = (
        "You are a strict factual verifier. "
        "Compare the AI response against the provided context only. "
        "Output ACCURATE if fully grounded. "
        "Otherwise output CRITIQUE: followed by specific unsupported claims."
    )
    user_prompt = (
        f"Context:\n{context}\n\n"
        f"AI Response:\n{response}\n\n"
        "Does the response contain information not supported by context?"
    )

    try:
        critique = generate_chat(system_prompt, user_prompt, 100).strip()
        if not critique:
            critique = "CRITIQUE: Empty verifier output."
    except Exception:
        critique = "CRITIQUE: Verification failed."

    return {
        "critique": critique,
        "revision_count": int(state.get("revision_count", 0)) + 1,
    }


def should_continue(state: dict) -> str:
    critique = (state.get("critique") or "").upper()
    revision_count = int(state.get("revision_count", 0))
    if "ACCURATE" in critique or revision_count >= 3:
        return "tts"
    return "llm"

def tts_node(state: dict) -> dict:
    print("Executing TTS...")
    response_text = state.get("llm_response", "Okay.")
    # Here, we'd use OpenAI TTS or Google TTS to write to a wav/mp3 file and return the path
    # For now, we simulate returning an encoded audio path
    return {"tts_audio_path": "/tmp/mock_tts_output.mp3"}

# ================================
# GRAPH COMPILATION
# ================================

def build_master_expert_graph():
    g = StateGraph(InterviewState)

    g.add_node("stt", stt_node)
    g.add_node("search", search_node)
    g.add_node("rag", rag_node)
    g.add_node("llm", llm_node)
    g.add_node("critic", critic_node)
    g.add_node("tts", tts_node)

    g.set_entry_point("stt")

    g.add_edge("stt", "search")
    g.add_edge("search", "rag")
    g.add_edge("rag", "llm")
    g.add_edge("llm", "critic")

    g.add_conditional_edges(
        "critic",
        should_continue,
        {
            "llm": "llm",
            "tts": "tts",
        },
    )

    g.set_finish_point("tts")

    return g.compile()


def build_interview_graph():
    return build_master_expert_graph()


interview_graph = build_master_expert_graph()
