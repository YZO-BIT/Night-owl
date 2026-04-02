"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Mic, Square, Loader2, Bot, ArrowLeft, Activity, User, ShieldAlert } from "lucide-react";

function normalizeTranscript(input: string): string {
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

async function typeInto(
  fullText: string,
  onChunk: (text: string) => void,
  opts?: { msPerChar?: number; maxMsPerChar?: number }
) {
  const msPerChar = Math.max(5, opts?.msPerChar ?? 12);
  const maxMsPerChar = Math.max(msPerChar, opts?.maxMsPerChar ?? 18);
  const step = () => Math.floor(Math.random() * 3) + 2;

  let i = 0;
  while (i < fullText.length) {
    i = Math.min(fullText.length, i + step());
    onChunk(fullText.slice(0, i));
    const jitter = Math.floor(Math.random() * (maxMsPerChar - msPerChar + 1)) + msPerChar;
    await new Promise((r) => setTimeout(r, jitter));
  }
}

function speakText(text: string) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  try {
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(cleaned);
    utter.lang = "en-US";
    utter.rate = 1;
    utter.pitch = 1;
    synth.speak(utter);
  } catch {
    // best-effort
  }
}

async function speakViaDeepgram(text: string): Promise<boolean> {
  // Note: caller should prevent overlaps by stopping any previous audio.
  try {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return false;

    const res = await fetch("/api/deepgram/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: cleaned }),
    });

    if (!res.ok) return false;
    const audioBlob = await res.blob();
    const url = URL.createObjectURL(audioBlob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

export default function InterviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic")?.trim() || "";
  const proctorEnabled = searchParams.get("proctor") === "1";
  const videoIdParam = searchParams.get("videoId")?.trim() || "";

  const [cameraStatus, setCameraStatus] = useState<"idle" | "requesting" | "enabled" | "blocked">("idle");
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionStarting, setSessionStarting] = useState(false);
  const [sessionEnding, setSessionEnding] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [contextStatus, setContextStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [contextSource, setContextSource] = useState<string>("");
  const [uploadedNotesText, setUploadedNotesText] = useState<string>("");
  const [uploadingNotes, setUploadingNotes] = useState(false);
  const [isTypingReply, setIsTypingReply] = useState(false);
  const [logs, setLogs] = useState<{role: 'user' | 'ai', text: string}[]>(() => ([
    { role: 'ai', text: topic ? `Welcome to the Milestone Interview on ${topic}. Start by summarizing what you learned, then we’ll go deeper.` : "Welcome to the Milestone Interview. Briefly explain the computational trade-offs of using a Transformer-based architecture over a standard LSTM in a real-time environment." }
  ]));
  const [mockTranscript, setMockTranscript] = useState("");
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const liveTranscriptRef = useRef<string>("");
  const sttInFlightRef = useRef(false);
  const sttQueuedRef = useRef(false);
  const sttCooldownUntilRef = useRef<number>(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [videoId, setVideoId] = useState<string>("");

  useEffect(() => {
    // Prefer URL param; fall back to localStorage (set by the Learn page).
    if (videoIdParam) {
      setVideoId(videoIdParam);
      return;
    }
    try {
      const stored = window.localStorage.getItem("lastLearnVideoId") || "";
      if (stored) setVideoId(stored);
    } catch {
      // ignore
    }
  }, [videoIdParam]);

  useEffect(() => {
    if (!proctorEnabled) return;
    let cancelled = false;

    (async () => {
      try {
        setCameraStatus("requesting");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.getTracks().forEach((t) => t.stop());
        setCameraStatus("enabled");
      } catch {
        if (!cancelled) setCameraStatus("blocked");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [proctorEnabled]);

  const ingestContext = async (id: string) => {
    const notes = uploadedNotesText.trim();
    if (notes) {
      setContextStatus("loading");
      setContextSource("docx");
      const iRes = await fetch("/api/interview/context/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, text: notes, source: "docx" }),
      });
      const iData = await iRes.json().catch(() => ({}));
      if (!iRes.ok) {
        setContextStatus("error");
        throw new Error((iData as any).error || "Failed to ingest docx context");
      }
      setContextStatus("ready");
      return;
    }

    const effectiveVideoId = videoId.trim();
    if (!effectiveVideoId) {
      // No video available: still mark ready so the interview can proceed on topic alone.
      setContextStatus("ready");
      setContextSource("topic");
      return;
    }

    setContextStatus("loading");
    setContextSource("youtube");
    try {
      const tRes = await fetch("/api/context/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: effectiveVideoId }),
      });
      const tData = await tRes.json().catch(() => ({}));
      if (!tRes.ok) {
        throw new Error((tData as any).error || "Failed to load YouTube transcript");
      }
      const text = typeof (tData as any).text === "string" ? (tData as any).text : "";
      if (!text.trim()) throw new Error("Empty transcript");

      const iRes = await fetch("/api/interview/context/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, text, source: "youtube" }),
      });
      const iData = await iRes.json().catch(() => ({}));
      if (!iRes.ok) {
        throw new Error((iData as any).error || "Failed to ingest context");
      }

      setContextStatus("ready");
    } catch (e) {
      setContextStatus("error");
      throw e;
    }
  };

  const uploadNotes = async (file: File) => {
    setSessionError(null);
    setUploadingNotes(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name || "notes.docx");
      const res = await fetch("/api/context/docx", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any).error || "Failed to read docx");
      }
      const text = typeof (data as any).text === "string" ? (data as any).text : "";
      if (!text.trim()) throw new Error("No text extracted from docx");
      setUploadedNotesText(text);
      setContextSource("docx");
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingNotes(false);
    }
  };

  const askFirstQuestion = async (id: string) => {
    const opener = topic
      ? `I just studied ${topic}. Start the interview with the first question.`
      : "Start the interview with the first question.";

    const res = await fetch("/api/interview/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: opener, sessionId: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any).error || "Interview start failed");

    const responseText = typeof (data as any).response_text === "string" ? (data as any).response_text : "";
    if (responseText.trim()) {
      setLogs((prev) => [...prev, { role: "ai", text: responseText.trim() }]);
    }
  };

  const startSession = async () => {
    if (sessionStarting || sessionId) return;
    setSessionError(null);
    setSessionStarting(true);
    setContextStatus("idle");
    try {
      const res = await fetch("/api/interview/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || "Failed to start session");
      const id = typeof (data as any).sessionId === "string" ? (data as any).sessionId : null;
      if (!id) throw new Error("Session did not return an id");
      setSessionId(id);
      sessionIdRef.current = id;

      // Load context from the watched video (if we have one), then ask first question.
      try {
        await ingestContext(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Context ingest failed";
        setSessionError(msg);
      }

      try {
        await askFirstQuestion(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to start interview";
        setSessionError(msg);
      }
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setSessionStarting(false);
    }
  };

  const endSession = async () => {
    if (sessionEnding || !sessionId) return;
    setSessionError(null);
    setSessionEnding(true);
    try {
      if (isRecording) {
        try {
          mediaRecorderRef.current?.stop();
        } catch {
          // ignore
        }
        setIsRecording(false);
      }
      const res = await fetch("/api/interview/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || "Failed to end session");
      setSessionId(null);
      sessionIdRef.current = null;
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : "Failed to end session");
    } finally {
      setSessionEnding(false);
    }
  };

  useEffect(() => {
    return () => {
      const id = sessionIdRef.current;
      if (!id) return;
      fetch("/api/interview/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
        keepalive: true,
      }).catch(() => undefined);
    };
  }, []);

  const startRecording = async () => {
    if (!sessionId) {
      setSessionError("Click 'Start Interview' first.");
      return;
    }
    if (contextStatus !== "ready") {
      setSessionError("Preparing interview context… please wait.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = preferredTypes.find((t) => {
        try {
          return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t);
        } catch {
          return false;
        }
      });
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      liveTranscriptRef.current = "";

      const transcribeChunk = async (blob: Blob) => {
        if (!blob || blob.size < 512) return;
        const now = Date.now();
        if (now < sttCooldownUntilRef.current) return;
        if (sttInFlightRef.current) {
          sttQueuedRef.current = true;
          return;
        }

        sttInFlightRef.current = true;
        try {
          const fd = new FormData();
          fd.append("audio", blob, "chunk.webm");
          const res = await fetch("/api/deepgram/stt", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = typeof (data as any)?.error === "string" ? (data as any).error : "STT failed";
            // brief cooldown so we don't spam Deepgram if it rejects/limits.
            sttCooldownUntilRef.current = Date.now() + 3500;
            setSessionError(`STT error: ${msg}`);
            return;
          }
          const t = typeof (data as any).transcript === "string" ? (data as any).transcript.trim() : "";
          if (!t) return;

          liveTranscriptRef.current = `${liveTranscriptRef.current} ${t}`.replace(/\s+/g, " ").trim();
          setMockTranscript(liveTranscriptRef.current);
        } finally {
          sttInFlightRef.current = false;
          if (sttQueuedRef.current) {
            sttQueuedRef.current = false;
            // Best-effort: transcribe the latest chunk in the buffer
            const last = audioChunksRef.current[audioChunksRef.current.length - 1];
            if (last) void transcribeChunk(last);
          }
        }
      };

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
        void transcribeChunk(e.data);
      };

      mediaRecorder.onstop = async () => {
        // In this demo flow we don’t upload audio yet; we use the text box as the transcript.
        new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsRecording(false);

        try {
          streamRef.current?.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        streamRef.current = null;

        const bestTranscript = liveTranscriptRef.current.trim() || mockTranscript;
        const normalized = normalizeTranscript(bestTranscript) || "Testing audio processor pipeline.";
        await processAudioMock(normalized);
      };

      // timeslice gives near-real-time chunks
      mediaRecorder.start(1400);
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      setIsRecording(true); // Mock mode if permission denied
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
       // Mock fallback
       setIsRecording(false);
       const normalized = normalizeTranscript(mockTranscript) || "Testing audio processor pipeline.";
       processAudioMock(normalized);
    }
  };

  const processAudioMock = async (transcript: string) => {
    const normalized = normalizeTranscript(transcript);
    if (!normalized) return;
    setIsProcessing(true);
    const newLogs = [...logs, {role: 'user', text: normalized} as const];
    setLogs(newLogs);
    setMockTranscript("");
    
    try {
        if (!sessionId) throw new Error("Session not initialized");
        const res = await fetch("/api/interview/cycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: normalized, sessionId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Interview cycle failed");

        const responseText = typeof data.response_text === "string" ? data.response_text : "";
        const aiIndex = newLogs.length;
        setLogs([...newLogs, { role: 'ai', text: "" }]);
        setIsTypingReply(true);
        await typeInto(responseText || "", (typed) => {
          setLogs((prev) => {
            if (aiIndex < 0 || aiIndex >= prev.length) return prev;
            const next = prev.slice();
            next[aiIndex] = { role: "ai", text: typed };
            return next;
          });
        });
        setIsTypingReply(false);
        try {
          if (ttsAudioRef.current) {
            ttsAudioRef.current.pause();
            ttsAudioRef.current.currentTime = 0;
          }
          if (ttsAudioUrlRef.current) {
            URL.revokeObjectURL(ttsAudioUrlRef.current);
            ttsAudioUrlRef.current = null;
          }
        } catch {
          // ignore
        }

        const ok = await (async () => {
          try {
            const cleaned = (responseText || "").replace(/\s+/g, " ").trim();
            if (!cleaned) return false;
            const res = await fetch("/api/deepgram/tts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: cleaned }),
            });
            if (!res.ok) return false;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            ttsAudioUrlRef.current = url;
            const audio = new Audio(url);
            ttsAudioRef.current = audio;
            audio.onended = () => {
              try {
                if (ttsAudioUrlRef.current) URL.revokeObjectURL(ttsAudioUrlRef.current);
              } finally {
                ttsAudioUrlRef.current = null;
              }
            };
            await audio.play();
            return true;
          } catch {
            return false;
          }
        })();
        if (!ok) speakText(responseText || "");
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : "Interview cycle failed");
        setLogs([...newLogs, { role: 'ai', text: "Error connecting to LangGraph Backend." }]);
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 overflow-x-hidden selection:bg-indigo-500/30 font-sans flex flex-col">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 -right-1/4 w-[600px] h-[600px] bg-indigo-900/10 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      {/* Navbar */}
      <nav className="relative z-50 flex items-center justify-between p-6 px-12 backdrop-blur-md border-b border-white/5">
        <div onClick={() => router.push('/')} className="flex items-center gap-3 cursor-pointer group">
          <ArrowLeft className="w-6 h-6 text-slate-400 group-hover:-translate-x-1 transition-transform" />
          <span className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Boss Protocol
          </span>
        </div>
        <div className="flex items-center gap-3">
          {proctorEnabled ? (
            <div className="flex items-center gap-3 px-5 py-2.5 bg-indigo-500/10 rounded-full border border-indigo-500/20">
              <ShieldAlert className="w-5 h-5 text-indigo-400" />
              <span className="text-sm font-bold uppercase tracking-widest text-indigo-400">
                Proctor Active{cameraStatus === "requesting" ? " • Camera…" : cameraStatus === "enabled" ? " • Camera On" : cameraStatus === "blocked" ? " • Camera Blocked" : ""}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-2.5 bg-white/5 rounded-full border border-white/10">
              <ShieldAlert className="w-5 h-5 text-slate-400" />
              <span className="text-sm font-bold uppercase tracking-widest text-slate-400">Proctor Off</span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void uploadNotes(f);
              // allow re-uploading same file
              e.currentTarget.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingNotes || !!sessionId}
            className="px-5 py-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-bold text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadingNotes ? "Uploading…" : uploadedNotesText ? "Notes Ready" : "Upload Notes (.docx)"}
          </button>

          <button
            onClick={startSession}
            disabled={!!sessionId || sessionStarting}
            className="px-5 py-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-bold text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sessionStarting ? "Starting…" : sessionId ? "Interview Started" : "Start Interview"}
          </button>
          <button
            onClick={endSession}
            disabled={!sessionId || sessionEnding}
            className="px-5 py-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-bold text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sessionEnding ? "Ending…" : "End Interview"}
          </button>
        </div>
      </nav>

      {sessionError ? (
        <div className="relative z-20 px-12 pt-6">
          <div className="max-w-7xl mx-auto px-5 py-3 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm">
            {sessionError}
          </div>
        </div>
      ) : null}

      <main className="flex-1 relative z-10 max-w-7xl mx-auto w-full px-6 py-12 flex flex-col lg:flex-row gap-8">
        
        {/* Left Col - Avatar & Vis */}
        <div className="lg:w-1/3 flex flex-col gap-6">
          <div className="relative aspect-square rounded-3xl overflow-hidden glass-panel flex flex-col items-center justify-center group">
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-transparent to-transparent z-10" />
            <img src="https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80" className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-50 transition-opacity mix-blend-luminosity duration-700" alt="AI Agent" />
            
            <div className="absolute top-6 left-6 z-20 flex items-center gap-2 px-3 py-1.5 bg-black/50 backdrop-blur rounded-full border border-white/10">
              <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-indigo-400 animate-ping' : 'bg-cyan-400'}`} />
              <span className="text-[10px] font-bold tracking-widest uppercase">Agent X-24</span>
            </div>

            <div className="relative z-20 flex items-end gap-1.5 h-32 mt-auto pb-12">
              <motion.div animate={{ height: isProcessing ? ["40%", "100%", "40%"] : "20%" }} transition={{ repeat: Infinity, duration: 1.2 }} className="w-2 bg-indigo-400 rounded-t-full rounded-b-full h-1/2" />
              <motion.div animate={{ height: isProcessing ? ["20%", "80%", "20%"] : "40%" }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-2 bg-cyan-400 rounded-t-full rounded-b-full h-3/4" />
              <motion.div animate={{ height: isProcessing ? ["60%", "100%", "60%"] : "30%" }} transition={{ repeat: Infinity, duration: 1.1 }} className="w-2 bg-indigo-300 rounded-t-full rounded-b-full h-full" />
              <motion.div animate={{ height: isProcessing ? ["30%", "90%", "30%"] : "50%" }} transition={{ repeat: Infinity, duration: 1.8 }} className="w-2 bg-indigo-500 rounded-t-full rounded-b-full h-1/3" />
              <motion.div animate={{ height: isProcessing ? ["50%", "100%", "50%"] : "20%" }} transition={{ repeat: Infinity, duration: 1.4 }} className="w-2 bg-cyan-300 rounded-t-full rounded-b-full h-2/3" />
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-8">
             <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-base tracking-widest uppercase flex items-center gap-3 text-indigo-400">
                  <Activity className="w-5 h-5" /> Telemetry
                </h3>
              </div>
              <div className="space-y-5">
                <div className="flex justify-between items-center text-base">
                  <span className="text-slate-400">Gaze Lock</span>
                  <span className="text-cyan-400 font-bold">Optimal</span>
                </div>
                <div className="flex justify-between items-center text-base">
                  <span className="text-slate-400">Audio Clarity</span>
                  <span className="text-cyan-400 font-bold">128kbps</span>
                </div>
                <div className="flex justify-between items-center text-base">
                  <span className="text-slate-400">Confidence</span>
                  <span className="text-indigo-400 font-bold">89%</span>
                </div>
              </div>
          </div>
        </div>

        {/* Right Col - Chat & Mic */}
        <div className="lg:w-2/3 flex flex-col gap-6">
          <div className="glass-panel flex-1 rounded-3xl p-6 md:p-10 flex flex-col shadow-2xl relative overflow-hidden">
            
            <div className="flex-1 overflow-y-auto space-y-8 pr-4 fancy-scrollbar">
              {logs.map((log, i) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={i} 
                  className={`flex ${log.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] rounded-3xl p-8 flex gap-5 ${
                    log.role === 'user' 
                      ? 'bg-indigo-500/10 border border-indigo-500/20 rounded-tr-sm' 
                      : 'bg-white/5 border border-white/10 rounded-tl-sm'
                  }`}>
                    <div className="mt-1">
                      {log.role === 'ai' ? <Bot className="w-8 h-8 text-cyan-400" /> : <User className="w-8 h-8 text-indigo-400" />}
                    </div>
                    <p className={`text-xl md:text-2xl leading-relaxed ${log.role === 'user' ? 'text-indigo-100' : 'text-slate-200'}`}>
                      {log.text}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="mt-8 pt-8 border-t border-white/10">
              <div className="flex flex-col md:flex-row gap-6 items-center">
                {sessionId && contextStatus === "ready" ? (
                  <button 
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isProcessing}
                    className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                      isRecording 
                        ? 'bg-red-500 hover:bg-red-600 shadow-[0_0_30px_rgba(239,68,68,0.5)] animate-pulse' 
                        : 'bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_30px_rgba(79,70,229,0.4)]'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isRecording ? <Square className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
                  </button>
                ) : (
                  <div className="w-20 h-20 rounded-full flex items-center justify-center border border-white/10 bg-white/5 text-slate-400 text-xs font-bold">
                    {sessionId ? (contextStatus === "loading" ? "Loading" : "Start") : "Start"}
                  </div>
                )}
                
                <div className="flex-1 w-full relative">
                  <input
                    type="text"
                    value={mockTranscript}
                    onChange={(e) => setMockTranscript(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      if (isProcessing || isTypingReply) return;
                      if (!sessionId) {
                        setSessionError("Click 'Start Interview' first.");
                        return;
                      }
                      if (contextStatus !== "ready") {
                        setSessionError("Preparing interview context… please wait.");
                        return;
                      }
                      const normalized = normalizeTranscript(mockTranscript);
                      if (!normalized) return;
                      processAudioMock(normalized);
                    }}
                    placeholder="Speak into microphone or type response..."
                    className="w-full bg-black/40 border border-white/10 focus:border-indigo-500/50 rounded-2xl h-20 px-8 text-xl text-white placeholder-slate-500 focus:outline-none transition-colors"
                  />
                  {isProcessing && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-3 text-indigo-400">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-base font-bold">Thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
