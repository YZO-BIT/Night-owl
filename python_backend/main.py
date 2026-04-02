from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
from dotenv import load_dotenv
import lmppl
from transformers import pipeline
from pinecone import Pinecone, ServerlessSpec
from sentence_transformers import SentenceTransformer
from tavily import TavilyClient
from typing import List, Optional, TypedDict
from langgraph.graph import StateGraph
import math
from huggingface_hub import InferenceClient

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Load env vars from workspace .env when running locally
try:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:
    pass

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PINECONE_API_KEY = (os.getenv("PINECONE_API_KEY") or "").strip()
TAVILY_API_KEY = (os.getenv("TAVILY_API_KEY") or "").strip()

if not PINECONE_API_KEY:
    raise RuntimeError("Missing PINECONE_API_KEY. Set it in .env or the environment.")
if not TAVILY_API_KEY:
    raise RuntimeError("Missing TAVILY_API_KEY. Set it in .env or the environment.")

print("Initializing Models and Services...")
tvly = TavilyClient(api_key=TAVILY_API_KEY)
scorer = lmppl.LM("gpt2")

# Text generation: prefer Hugging Face hosted inference (better quality, no local model load)
HF_KEY = (os.getenv("HF_KEY") or "").strip()
HF_MODEL = (os.getenv("HF_MODEL") or "Qwen/Qwen2.5-7B-Instruct").strip() or "Qwen/Qwen2.5-7B-Instruct"

hf_client: Optional[InferenceClient] = None
if HF_KEY:
    try:
        hf_client = InferenceClient(model=HF_MODEL, token=HF_KEY)
    except Exception:
        hf_client = None

_local_generator = None

def _ensure_local_generator():
    global _local_generator
    if _local_generator is None:
        _local_generator = pipeline("text-generation", model="gpt2")
    return _local_generator

def _clamp_tokens(max_new_tokens: int) -> int:
    try:
        n = int(max_new_tokens)
    except Exception:
        n = 128
    return max(16, min(512, n))


def generate_text_completion(prompt: str, max_new_tokens: int) -> str:
    """Best-effort completion for legacy prompt strings."""
    max_new_tokens = _clamp_tokens(max_new_tokens)

    # Hosted HF inference first
    if hf_client is not None:
        # Prefer chat-completions when available (better for instruct models)
        try:
            chat = hf_client.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_new_tokens,
                temperature=0.7,
                top_p=0.9,
            )
            content = ""
            try:
                content = chat.choices[0].message.content  # type: ignore[attr-defined]
            except Exception:
                content = ""
            if isinstance(content, str) and content.strip():
                return content.strip()
        except Exception:
            pass

        try:
            out = hf_client.text_generation(
                prompt,
                max_new_tokens=max_new_tokens,
                temperature=0.7,
                top_p=0.9,
                do_sample=True,
            )
            return (out or "").strip()
        except Exception:
            # fall through to local
            pass

    # Local fallback
    try:
        gen = _ensure_local_generator()
        output = gen(prompt, max_new_tokens=max_new_tokens, return_full_text=False, num_return_sequences=1)
        return (output[0].get("generated_text") or "").strip()
    except Exception:
        return ""


def generate_chat(system_prompt: str, user_prompt: str, max_new_tokens: int) -> str:
    """Preferred generation API for instruction-following behavior."""
    max_new_tokens = _clamp_tokens(max_new_tokens)
    messages = [
        {"role": "system", "content": (system_prompt or "").strip()},
        {"role": "user", "content": (user_prompt or "").strip()},
    ]

    if hf_client is not None:
        try:
            chat = hf_client.chat_completion(
                messages=messages,
                max_tokens=max_new_tokens,
                temperature=0.7,
                top_p=0.9,
            )
            content = ""
            try:
                content = chat.choices[0].message.content  # type: ignore[attr-defined]
            except Exception:
                content = ""
            if isinstance(content, str) and content.strip():
                return content.strip()
        except Exception:
            pass

    # Fallback to plain completion
    joined = f"SYSTEM:\n{system_prompt}\n\nUSER:\n{user_prompt}\n\nASSISTANT:".strip()
    return generate_text_completion(joined, max_new_tokens)
pc = Pinecone(api_key=PINECONE_API_KEY)
index_name = "interview-ai"
if index_name not in pc.list_indexes().names():
    pc.create_index(name=index_name, dimension=384, metric="cosine", spec=ServerlessSpec(cloud="aws", region="us-east-1"))
index = pc.Index(index_name)
model = SentenceTransformer("all-MiniLM-L6-v2")
print("Initialization Complete.")

# ================================
# LANGGRAPH ORCHESTRATION PIPELINE
# ================================

def stt_node(state: dict) -> dict:
    print("[LangGraph] Executing STT...")
    return {"transcript": state.get("transcript", "Mock transcribed text of user's voice.")}

def search_node(state: dict) -> dict:
    print("[LangGraph] Executing Search...")
    if state.get("mode") == "fast":
        return {"search_results": ""}
    try:
        res = tvly.search(query=state.get("transcript", "") + " interview best practices")
        return {"search_results": str(res.get("results", []))[:1000]}
    except:
        return {"search_results": ""}

def rag_node(state: dict) -> dict:
    print("[LangGraph] Executing RAG...")
    try:
        vector = model.encode(state.get("transcript", "")).tolist()

        session_id = str(state.get("session_id") or "").strip()
        if session_id:
            try:
                scoped = index.query(vector=vector, top_k=4, include_metadata=True, namespace=session_id)
                scoped_text = " ".join(
                    [m.get("metadata", {}).get("text", "") for m in (scoped.get("matches") or [])]
                ).strip()
                if scoped_text:
                    return {"rag_context": scoped_text}
            except Exception:
                pass

        results = index.query(vector=vector, top_k=2, include_metadata=True)
        return {"rag_context": " ".join([m["metadata"]["text"] for m in results["matches"]])}
    except:
        return {"rag_context": "No context found."}

def llm_node(state: dict) -> dict:
    print("[LangGraph] Executing LLM...")

    topic = (state.get("topic") or "").strip()
    search_context = (state.get("search_results") or "")
    rag_context = (state.get("rag_context") or "")
    transcript = (state.get("transcript") or "")

    # Keep contexts small to reduce latency and hallucinations
    search_context = str(search_context)[:1200]
    rag_context = str(rag_context)[:1500]
    transcript = str(transcript)[:1200]

    system_prompt = (
        "You are a professional technical interviewer. "
        "Ask ONE clear interview question at a time. "
        "Base your question strictly on the topic and the provided RAG context (what the candidate studied). "
        "Do not switch topics or programming languages. "
        "Do not provide solutions; only ask the next question."
    )

    user_prompt = (
        f"Topic: {topic or 'General'}\n\n"
        f"Study context (RAG):\n{rag_context}\n\n"
        f"Candidate last answer:\n{transcript}\n\n"
        "Task: Ask the next interview question.\n"
        "Output rules: Output ONLY the question text. No labels, no bullets, no extra commentary."
    )

    max_tokens = 80 if state.get("mode") == "fast" else 180
    response = generate_chat(system_prompt, user_prompt, max_tokens)
    if not response:
        response = "I see. Could you elaborate slightly?"
    return {"llm_response": response}

def tts_node(state: dict) -> dict:
    print("[LangGraph] Executing TTS...")
    return {"tts_audio_path": "/tmp/mock_tts_output.mp3", "final_response": state.get("llm_response")}

def build_graph():
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

interview_graph = build_graph()

# ================================
# ENDPOINTS
# ================================

class InterviewPayload(BaseModel):
    transcript: str
    mode: Optional[str] = None
    topic: Optional[str] = None
    session_id: Optional[str] = None

@app.post("/api/interview_cycle")
def execute_interview_cycle(payload: InterviewPayload):
    try:
        initial_state = {
            "transcript": payload.transcript,
            "mode": payload.mode,
            "topic": payload.topic,
            "session_id": payload.session_id,
        }
        final_state = interview_graph.invoke(initial_state)
        return {"response_text": final_state.get("final_response"), "audio_url": final_state.get("tts_audio_path")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class TextPayload(BaseModel): text: List[str]
class GeneratePayload(BaseModel): prompt: str
class StorePayload(BaseModel): id: str; text: str
class RetrievePayload(BaseModel): query: str
class SearchPayload(BaseModel): query: str
class IngestContextPayload(BaseModel):
    session_id: str
    text: str
    source: Optional[str] = None
    chunk_chars: Optional[int] = 900
    overlap_chars: Optional[int] = 120
class VideoPickPayload(BaseModel):
    topic: str
    stage_title: str
    top_k: Optional[int] = 8
    max_youtube: Optional[int] = 10

@app.post("/api/perplexity")
def get_perplexity(payload: TextPayload): return {"scores": list(zip(payload.text, scorer.get_perplexity(payload.text)))}
@app.post("/api/generate")
def generate_text(payload: GeneratePayload): 
    try:
        system_prompt = (
            "You are a precise assistant. Follow the user's constraints exactly. "
            "Do not change the requested topic or programming language. "
            "If the user asks for a numbered list with an exact count, comply exactly."
        )
        generated = generate_chat(system_prompt, payload.prompt, 240)
        return {"generated_text": generated}
    except Exception as e:
        print("GENERATE ERROR:", e)
        raise HTTPException(status_code=500, detail=str(e))
@app.post("/api/store")
def store_data(payload: StorePayload): index.upsert([(payload.id, model.encode(payload.text).tolist(), {"text": payload.text})]); return {"status": "stored"}
@app.post("/api/retrieve")
def retrieve_data(payload: RetrievePayload): return {"context": " ".join([m["metadata"]["text"] for m in index.query(vector=model.encode(payload.query).tolist(), top_k=3, include_metadata=True)["matches"]])}
@app.post("/api/search")
def search_data(payload: SearchPayload): return {"results": tvly.search(payload.query)}


def _chunk_text(text: str, chunk_chars: int, overlap_chars: int) -> List[str]:
    t = (text or "").replace("\r", "\n")
    t = "\n".join([line.strip() for line in t.split("\n") if line.strip()])
    if not t:
        return []
    chunk_chars = max(200, min(2400, int(chunk_chars or 900)))
    overlap_chars = max(0, min(chunk_chars // 2, int(overlap_chars or 120)))

    out: List[str] = []
    i = 0
    n = len(t)
    while i < n:
        j = min(n, i + chunk_chars)
        chunk = t[i:j].strip()
        if chunk:
            out.append(chunk)
        if j >= n:
            break
        i = max(0, j - overlap_chars)
    return out


@app.post("/api/ingest_context")
def ingest_context(payload: IngestContextPayload):
    session_id = (payload.session_id or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Missing text")

    source = (payload.source or "").strip()[:60] or "context"
    chunks = _chunk_text(text, int(payload.chunk_chars or 900), int(payload.overlap_chars or 120))
    if not chunks:
        raise HTTPException(status_code=400, detail="No usable text after cleanup")

    vectors = []
    for idx, chunk in enumerate(chunks[:80]):
        emb = model.encode(chunk).tolist()
        vectors.append((f"{session_id}-{idx}", emb, {"text": chunk, "source": source}))

    # Store in a session namespace so interview RAG uses *what the user studied*.
    index.upsert(vectors=vectors, namespace=session_id)
    return {"ok": True, "session_id": session_id, "chunks": len(vectors), "source": source}

def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += float(x) * float(y)
        na += float(x) * float(x)
        nb += float(y) * float(y)
    denom = math.sqrt(na) * math.sqrt(nb)
    return float(dot / denom) if denom > 1e-12 else 0.0

def _safe_text(x: object) -> str:
    return x.strip() if isinstance(x, str) else ""

def _is_embeddable_youtube(url: str) -> bool:
    u = (url or "").lower()
    return (
        "youtube.com/watch" in u
        or "youtu.be/" in u
        or "youtube.com/shorts/" in u
        or "m.youtube.com/watch" in u
        or "youtube.com/live/" in u
        or "youtube.com/embed/" in u
        or "youtube-nocookie.com/" in u
    )

@app.post("/api/video_pick")
def video_pick(payload: VideoPickPayload):
    topic = _safe_text(payload.topic)
    stage_title = _safe_text(payload.stage_title) or topic
    if not topic:
        raise HTTPException(status_code=400, detail="Missing topic")

    top_k = int(payload.top_k or 8)
    top_k = max(1, min(20, top_k))
    max_youtube = int(payload.max_youtube or 10)
    max_youtube = max(3, min(20, max_youtube))

    stage_text = f"{topic} — {stage_title}"
    stage_vec = model.encode(stage_text).tolist()

    # 1) Find strong, stage-specific resources (reddit/blog/leetcode style pages)
    seed_query = f"best {stage_title} {topic} resources reddit blog interview"
    try:
        seed = tvly.search(query=seed_query, max_results=12)
    except Exception:
        seed = {"results": []}

    seed_results = seed.get("results", []) if isinstance(seed, dict) else []
    scored_seed = []
    for r in seed_results:
        url = _safe_text(r.get("url") if isinstance(r, dict) else "")
        title = _safe_text(r.get("title") if isinstance(r, dict) else "")
        content = _safe_text(r.get("content") if isinstance(r, dict) else "")
        if not url:
            continue
        text = (title + "\n" + content)[:2000]
        try:
            vec = model.encode(text).tolist()
            score = _cosine(stage_vec, vec)
        except Exception:
            score = 0.0
        scored_seed.append((score, {"url": url, "title": title or url, "content": content}))

    scored_seed.sort(key=lambda x: x[0], reverse=True)
    top_seed = [x[1] for x in scored_seed[:top_k]]

    # 2) Use the top seed titles to build a better YouTube search query
    top_titles = [s.get("title", "") for s in top_seed if isinstance(s, dict)]
    hint = " ".join([t for t in top_titles[:3] if isinstance(t, str) and t.strip()])
    # Try to bias toward URLs we can iframe-embed (watch/shorts/youtu.be)
    yt_query = f"{topic} {stage_title} {hint} tutorial youtube watch"
    yt_query = " ".join(yt_query.split())

    try:
        yt = tvly.search(query=yt_query, max_results=max_youtube)
    except Exception:
        yt = {"results": []}

    yt_results = yt.get("results", []) if isinstance(yt, dict) else []
    scored_yt = []
    for r in yt_results:
        url = _safe_text(r.get("url") if isinstance(r, dict) else "")
        title = _safe_text(r.get("title") if isinstance(r, dict) else "")
        content = _safe_text(r.get("content") if isinstance(r, dict) else "")
        if not url:
            continue
        if not _is_embeddable_youtube(url):
            continue
        text = (title + "\n" + content)[:2000]
        try:
            vec = model.encode(text).tolist()
            score = _cosine(stage_vec, vec)
        except Exception:
            score = 0.0
        scored_yt.append((score, {"url": url, "title": title or url, "content": content}))

    scored_yt.sort(key=lambda x: x[0], reverse=True)
    ranked = [x[1] for x in scored_yt]

    return {
        "stage_text": stage_text,
        "seed_query": seed_query,
        "youtube_query": yt_query,
        "seed_top": top_seed,
        "results": ranked,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
