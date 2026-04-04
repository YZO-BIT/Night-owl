"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Bot, ArrowLeft, Activity, User, ShieldAlert, TrendingUp } from "lucide-react";
import { upsertInterviewTaskHistory } from "@/lib/interviewTaskHistory";
import { completeInterviewMentorshipTask } from "@/lib/mentorshipPlan";

type InterviewSummary = {
  topic: string;
  coveredQuestions: number;
  targetQuestions: number;
  averageWordsPerAnswer: number;
  conciseAnswerRatio: number;
  efficiencyScore: number;
  complete: boolean;
  reason: string;
  strengths: string[];
  gaps: string[];
  improvementSteps: string[];
  finalFeedback: string;
};

function normalizeTranscript(input: string): string {
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function mergeTranscript(previous: string, incoming: string): string {
  const prev = (previous || "").replace(/\s+/g, " ").trim();
  const next = (incoming || "").replace(/\s+/g, " ").trim();
  if (!next) return prev;
  if (!prev) return next;
  if (prev === next || prev.includes(next)) return prev;

  const maxOverlap = Math.min(prev.length, next.length);
  for (let overlap = maxOverlap; overlap >= 12; overlap -= 1) {
    if (prev.slice(-overlap).toLowerCase() === next.slice(0, overlap).toLowerCase()) {
      return `${prev}${next.slice(overlap)}`.replace(/\s+/g, " ").trim();
    }
  }

  return `${prev} ${next}`.replace(/\s+/g, " ").trim();
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

export default function InterviewPage() {
  const MAX_LOGS = 200;
  const MAX_AUDIO_CHUNKS = 8;
  const MAX_NOTES_CHARS = 50_000;

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
  const [finalSummary, setFinalSummary] = useState<InterviewSummary | null>(null);
  const [sttStatus, setSttStatus] = useState<"idle" | "listening" | "transcribing">("idle");
  const [questionProgress, setQuestionProgress] = useState<{ total: number; asked: number; remaining: number }>({
    total: 10,
    asked: 0,
    remaining: 10,
  });
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
  const recorderMimeTypeRef = useRef<string>("audio/webm");
  const lastLiveChunkTranscriptRef = useRef<string>("");
  const lastSpeechAtRef = useRef<number>(0);
  const lastPresencePromptAtRef = useRef<number>(0);
  const suppressStopProcessingRef = useRef(false);
  const startRecordingRef = useRef<() => Promise<void>>(async () => undefined);
  const processAudioRef = useRef<(transcript: string) => Promise<void>>(async () => undefined);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string | null>(null);
  const performanceSaveTimerRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [videoId, setVideoId] = useState<string>("");

  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel?.();
      } catch {
        // ignore
      }

      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          suppressStopProcessingRef.current = true;
          mediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }

      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      streamRef.current = null;

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

      audioChunksRef.current = [];
      liveTranscriptRef.current = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transcribeBlob = async (blob: Blob): Promise<string> => {
    if (!blob || blob.size < 2_000) return "";
    const mime = (blob.type || recorderMimeTypeRef.current || "audio/webm").trim();
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "mp4" : "webm";
    const file = new File([blob], `audio.${ext}`, { type: mime });
    const fd = new FormData();
    fd.append("audio", file);

    const res = await fetch("/api/deepgram/stt", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof (data as { error?: unknown })?.error === "string" ? (data as { error: string }).error : "STT failed";
      throw new Error(msg);
    }

    return typeof (data as { transcript?: unknown }).transcript === "string"
      ? (data as { transcript: string }).transcript.trim()
      : "";
  };

  const performance = useMemo(() => {
    const userMessages = logs.filter((item) => item.role === "user");
    const answered = userMessages.length;
    const totalWords = userMessages.reduce((sum, item) => {
      const words = item.text.trim().split(/\s+/).filter(Boolean).length;
      return sum + words;
    }, 0);
    const averageWords = answered > 0 ? Math.round(totalWords / answered) : 0;
    const conciseAnswers = userMessages.filter((item) => {
      const words = item.text.trim().split(/\s+/).filter(Boolean).length;
      return words >= 8 && words <= 45;
    }).length;
    const conciseRatio = answered > 0 ? conciseAnswers / answered : 0;

    const progressPercent =
      questionProgress.total > 0
        ? Math.min(100, Math.round((questionProgress.asked / questionProgress.total) * 100))
        : 0;
    const baseEfficiency = Math.min(100, 40 + answered * 10 + Math.round(conciseRatio * 35));
    const cameraPenalty = proctorEnabled && cameraStatus === "blocked" ? 12 : 0;
    const efficiency = Math.max(0, baseEfficiency - cameraPenalty);

    const communicationFeedback =
      averageWords === 0
        ? "Start with one clear, specific answer to calibrate your baseline."
        : averageWords < 10
          ? "Expand answers with one concrete example to improve depth."
          : averageWords > 60
            ? "Trim long responses; keep key points first for better clarity."
            : "Balanced answer length. Keep this structure for consistency.";

    const momentumFeedback =
      answered >= 5
        ? "Great rhythm. You are sustaining interview pace."
        : answered >= 3
          ? "Good momentum. Complete a few more rounds for stronger signal."
          : "Early stage. Finish more Q&A turns to build reliable metrics.";

    return {
      answered,
      averageWords,
      conciseRatio,
      progressPercent,
      efficiency,
      communicationFeedback,
      momentumFeedback,
    };
  }, [logs, proctorEnabled, cameraStatus, questionProgress]);

  const syncProgressFromData = (
    data: unknown,
    fallbackAsked?: number
  ) => {
    const payload = (data || {}) as {
      total_questions?: unknown;
      asked_questions?: unknown;
      remaining_questions?: unknown;
    };

    const total = typeof payload.total_questions === "number" ? payload.total_questions : questionProgress.total;
    const asked = typeof payload.asked_questions === "number" ? payload.asked_questions : (fallbackAsked ?? questionProgress.asked);
    const remaining = typeof payload.remaining_questions === "number"
      ? payload.remaining_questions
      : Math.max(0, total - asked);

    setQuestionProgress({
      total: Math.max(10, Math.min(20, total || 10)),
      asked: Math.max(0, asked),
      remaining: Math.max(0, remaining),
    });
  };

  const persistCompletedTask = (summary: InterviewSummary, activeSessionId: string, payload?: unknown) => {
    const data = (payload || {}) as {
      total_questions?: unknown;
      asked_questions?: unknown;
    };

    const totalFromPayload = typeof data.total_questions === "number" ? data.total_questions : questionProgress.total;
    const askedFromPayload = typeof data.asked_questions === "number" ? data.asked_questions : questionProgress.asked;

    upsertInterviewTaskHistory({
      sessionId: activeSessionId,
      topic,
      summary,
      fallbackPerformance: {
        answered: performance.answered,
        averageWords: performance.averageWords,
        conciseRatio: performance.conciseRatio,
        efficiency: performance.efficiency,
        progressPercent:
          totalFromPayload > 0
            ? Math.min(100, Math.round((askedFromPayload / totalFromPayload) * 100))
            : performance.progressPercent,
      },
      fallbackQuestionProgress: {
        asked: askedFromPayload,
        total: totalFromPayload,
      },
    });

    const rating = Math.max(0, Math.min(5, Math.round((summary.efficiencyScore / 20) * 10) / 10));
    completeInterviewMentorshipTask({
      feedback: summary.finalFeedback,
      rating,
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (performanceSaveTimerRef.current) {
      window.clearTimeout(performanceSaveTimerRef.current);
    }

    performanceSaveTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          "study.interview.performance",
          JSON.stringify({
            ...performance,
            topic,
            updatedAt: new Date().toISOString(),
          })
        );
      } catch {
        // ignore storage failures
      }
    }, 2000);

    return () => {
      if (performanceSaveTimerRef.current) {
        window.clearTimeout(performanceSaveTimerRef.current);
        performanceSaveTimerRef.current = null;
      }
    };
  }, [performance, topic]);

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
      const clipped = text.length > MAX_NOTES_CHARS ? text.slice(0, MAX_NOTES_CHARS) : text;
      setUploadedNotesText(clipped);
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
    syncProgressFromData(data, 1);

    const responseText = typeof (data as any).response_text === "string" ? (data as any).response_text : "";
    if (responseText.trim()) {
      setLogs((prev) => {
        const next = [...prev, { role: "ai", text: responseText.trim() } as const];
        return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
      });
      lastSpeechAtRef.current = Date.now();
    }
  };

  const startSession = async () => {
    if (sessionStarting || sessionId) return;
    if (proctorEnabled && cameraStatus !== "enabled") {
      setSessionError("Proctored interview requires active camera before starting.");
      return;
    }
    setSessionError(null);
    setFinalSummary(null);
    setQuestionProgress({ total: 10, asked: 0, remaining: 10 });
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
          suppressStopProcessingRef.current = true;
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
      const maybeSummary = (data as { summary?: InterviewSummary }).summary;
      if (maybeSummary) {
        setFinalSummary(maybeSummary);
        persistCompletedTask(maybeSummary, sessionId, data);
      }
      syncProgressFromData(data);
      setSessionId(null);
      sessionIdRef.current = null;
      setSttStatus("idle");
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
    if (proctorEnabled && cameraStatus !== "enabled") {
      setSessionError("Camera must stay active in proctored mode.");
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
      recorderMimeTypeRef.current = mediaRecorder.mimeType || mimeType || "audio/webm";
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      liveTranscriptRef.current = "";
      lastLiveChunkTranscriptRef.current = "";
      setSttStatus("listening");

      const transcribeChunk = async () => {
        if (audioChunksRef.current.length === 0) return;
        const rolling = audioChunksRef.current.slice(-3);
        const blob = new Blob(rolling, { type: recorderMimeTypeRef.current || "audio/webm" });
        if (!blob || blob.size < 8_000) return;

        const now = Date.now();
        if (now < sttCooldownUntilRef.current) return;
        if (sttInFlightRef.current) {
          sttQueuedRef.current = true;
          return;
        }

        sttInFlightRef.current = true;
        try {
          setSttStatus("transcribing");
          const t = normalizeTranscript(await transcribeBlob(blob));
          if (!t) {
            setSttStatus("listening");
            return;
          }

          if (t === lastLiveChunkTranscriptRef.current) {
            setSttStatus("listening");
            return;
          }

          lastLiveChunkTranscriptRef.current = t;
          liveTranscriptRef.current = mergeTranscript(liveTranscriptRef.current, t);
          setMockTranscript(liveTranscriptRef.current);
          lastSpeechAtRef.current = Date.now();
          setSttStatus("listening");
          setSessionError(null);

          // Keep only the most recent chunks to avoid unbounded memory growth
          if (audioChunksRef.current.length > 2) {
            audioChunksRef.current = audioChunksRef.current.slice(-2);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "STT failed";
          const unsupported = /corrupt|unsupported data|failed to process audio/i.test(msg);
          sttCooldownUntilRef.current = Date.now() + (unsupported ? 5_000 : 3_500);
          if (!unsupported) {
            setSessionError(`STT error: ${msg}`);
          }
          setSttStatus("listening");
        } finally {
          sttInFlightRef.current = false;
          if (sttQueuedRef.current) {
            sttQueuedRef.current = false;
            void transcribeChunk();
          }
        }
      };

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
        if (audioChunksRef.current.length > MAX_AUDIO_CHUNKS) {
          audioChunksRef.current = audioChunksRef.current.slice(-MAX_AUDIO_CHUNKS);
        }
        void transcribeChunk();
      };

      mediaRecorder.onstop = async () => {
        const completeBlob = new Blob(audioChunksRef.current, { type: recorderMimeTypeRef.current || "audio/webm" });
        setIsRecording(false);

        try {
          streamRef.current?.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        streamRef.current = null;
        audioChunksRef.current = [];
        setSttStatus("idle");

        if (suppressStopProcessingRef.current) {
          suppressStopProcessingRef.current = false;
          return;
        }

        let bestTranscript = liveTranscriptRef.current.trim() || mockTranscript.trim();
        if (!bestTranscript && completeBlob.size >= 6_000) {
          try {
            setSttStatus("transcribing");
            bestTranscript = await transcribeBlob(completeBlob);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "STT failed";
            setSessionError(`STT error: ${msg}`);
          } finally {
            setSttStatus("idle");
          }
        }

        const normalized = normalizeTranscript(bestTranscript);
        if (normalized) {
          liveTranscriptRef.current = "";
          lastLiveChunkTranscriptRef.current = "";
          setMockTranscript("");
          await processAudioMock(normalized);
        } else if (completeBlob.size >= 6_000) {
          setSessionError("Could not transcribe speech. Try speaking a bit slower and closer to your microphone.");
        }
      };

      // timeslice gives near-real-time chunks
      mediaRecorder.start(2500);
      lastSpeechAtRef.current = Date.now();
      lastPresencePromptAtRef.current = 0;
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      setIsRecording(false);
      setSttStatus("idle");
      setSessionError("Microphone access failed. Allow mic permission for speech-to-text.");
    }
  };

  const processAudioMock = async (transcript: string) => {
    const normalized = normalizeTranscript(transcript);
    if (!normalized) return;
    setIsProcessing(true);
    const baseLogs = logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs;
    const newLogs = [...baseLogs, { role: "user", text: normalized } as const];
    setLogs(newLogs);
    setMockTranscript("");
    
    try {
        if (!sessionId) throw new Error("Session not initialized");
        const activeSessionId = sessionId;
        const res = await fetch("/api/interview/cycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: normalized, sessionId: activeSessionId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Interview cycle failed");

        const responseText = typeof data.response_text === "string" ? data.response_text : "";
        const maybeSummary = (data as { summary?: InterviewSummary }).summary;
        const isComplete = (data as { is_complete?: boolean }).is_complete === true;
        syncProgressFromData(data);
        const aiIndex = newLogs.length;
        const cappedLogs = newLogs.length > MAX_LOGS ? newLogs.slice(-MAX_LOGS) : newLogs;
        setLogs([...cappedLogs, { role: "ai", text: "" }]);
        setIsTypingReply(true);
        await typeInto(responseText || "", (typed) => {
          setLogs((prev) => {
            if (aiIndex < 0 || aiIndex >= prev.length) return prev;
            const next = prev.slice();
            next[aiIndex] = { role: "ai", text: typed };
            return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
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

        if (!isComplete) {
          lastSpeechAtRef.current = Date.now();
        }

        if (isComplete) {
          if (maybeSummary) {
            setFinalSummary(maybeSummary);
            persistCompletedTask(maybeSummary, activeSessionId, data);
          }
          syncProgressFromData(data, questionProgress.total);
          setSessionId(null);
          sessionIdRef.current = null;
          setIsRecording(false);
          setSttStatus("idle");
          setSessionError(null);
        }
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : "Interview cycle failed");
        setLogs((prev) => {
          const next = [...prev, { role: "ai", text: "Error connecting to LangGraph Backend." } as const];
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
        });
    }
    setIsProcessing(false);
  };

  startRecordingRef.current = startRecording;
  processAudioRef.current = processAudioMock;

  useEffect(() => {
    if (!sessionId || contextStatus !== "ready") return;
    if (proctorEnabled && cameraStatus !== "enabled") return;
    if (isRecording || sessionEnding) return;
    void startRecordingRef.current();
  }, [sessionId, contextStatus, proctorEnabled, cameraStatus, isRecording, sessionEnding]);

  useEffect(() => {
    if (!sessionId || !isRecording) return;

    const timer = setInterval(() => {
      if (!sessionIdRef.current) return;
      if (isProcessing || isTypingReply || sessionEnding) return;

      const silentForMs = Date.now() - (lastSpeechAtRef.current || Date.now());
      if (silentForMs < 15_000) return;

      const buffered = normalizeTranscript(liveTranscriptRef.current);
      if (buffered) {
        liveTranscriptRef.current = "";
        setMockTranscript("");
        lastSpeechAtRef.current = Date.now();
        void processAudioRef.current(buffered);
        return;
      }

      if (Date.now() - lastPresencePromptAtRef.current < 30_000) return;
      lastPresencePromptAtRef.current = Date.now();
      const prompt = "I have not heard you for 15 seconds. Are you still there?";
      setLogs((prev) => [...prev, { role: "ai", text: prompt }]);
      speakText(prompt);
    }, 1000);

    return () => clearInterval(timer);
  }, [sessionId, isRecording, isProcessing, isTypingReply, sessionEnding]);

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] overflow-x-hidden selection:bg-indigo-500/30 font-sans flex flex-col">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 -right-1/4 w-[600px] h-[600px] bg-indigo-900/10 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      {/* Navbar */}
      <nav className="relative z-50 flex items-center justify-between p-6 px-12 backdrop-blur-md border-b border-white/5">
        <div onClick={() => router.push('/')} className="flex items-center gap-3 cursor-pointer group">
          <ArrowLeft className="w-6 h-6 text-slate-400 group-hover:-translate-x-1 transition-transform" />
          <span className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400">
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
            disabled={!!sessionId || sessionStarting || (proctorEnabled && cameraStatus !== "enabled")}
            className="px-5 py-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-bold text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sessionStarting
              ? "Starting…"
              : sessionId
                ? "Interview Started"
                : proctorEnabled && cameraStatus !== "enabled"
                  ? "Enable Camera To Start"
                  : "Start Interview"}
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
                  <span className="text-slate-400">Speech To Text</span>
                  <span className="text-cyan-400 font-bold">
                    {sttStatus === "transcribing" ? "Transcribing" : sttStatus === "listening" ? "Listening" : "Idle"}
                  </span>
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
                <div className="w-full md:w-auto min-w-[220px] h-20 rounded-2xl border border-white/10 bg-white/5 px-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Hands-Free</p>
                    <p className="text-sm text-slate-200 font-semibold">
                      {sessionId
                        ? contextStatus === "loading"
                          ? "Preparing context..."
                          : isRecording
                            ? "Turn detection active"
                            : "Waiting for microphone"
                        : "Start interview to begin"}
                    </p>
                  </div>
                  <div className={`w-3 h-3 rounded-full ${isRecording ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                </div>
                
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
              <div className="mt-4 text-sm text-slate-400">
                Voice pipeline: continuous microphone capture, 15-second silence turn detection, live speech-to-text, interview response generation, and verbal AI audio reply.
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Context source: {contextSource || "pending"}
              </div>
            </div>

          </div>

          <div className="glass-panel rounded-3xl p-6 md:p-8">
            <div className="grid grid-cols-1 gap-6">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-bold tracking-widest uppercase text-indigo-300 flex items-center gap-2 mb-4">
                  <TrendingUp className="w-4 h-4" /> Progress
                </h3>
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-400">Interview Completion</span>
                      <span className="text-indigo-300 font-bold">{performance.progressPercent}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-500"
                        style={{ width: `${performance.progressPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Questions Asked</span>
                    <span className="text-slate-100 font-semibold">{questionProgress.asked}/{questionProgress.total}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Questions Remaining</span>
                    <span className="text-slate-100 font-semibold">{questionProgress.remaining}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Avg. Words / Answer</span>
                    <span className="text-slate-100 font-semibold">{performance.averageWords}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Concise Response Ratio</span>
                    <span className="text-slate-100 font-semibold">{Math.round(performance.conciseRatio * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {finalSummary ? (
            <div className="glass-panel rounded-3xl p-6 md:p-8 border border-emerald-500/30 bg-emerald-500/5">
              <h3 className="text-lg md:text-xl font-bold text-emerald-300 mb-4">
                Final Interview Feedback
              </h3>
              <p className="text-slate-200 whitespace-pre-line leading-relaxed mb-6">{finalSummary.finalFeedback}</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <h4 className="text-xs uppercase tracking-widest text-cyan-300 font-bold mb-3">Strengths</h4>
                  <ul className="space-y-2 text-sm text-slate-200 list-disc pl-5">
                    {finalSummary.strengths.length > 0 ? (
                      finalSummary.strengths.map((item, idx) => <li key={`s-${idx}`}>{item}</li>)
                    ) : (
                      <li>Interview participation was consistent.</li>
                    )}
                  </ul>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <h4 className="text-xs uppercase tracking-widest text-amber-300 font-bold mb-3">Where You Lack</h4>
                  <ul className="space-y-2 text-sm text-slate-200 list-disc pl-5">
                    {finalSummary.gaps.length > 0 ? (
                      finalSummary.gaps.map((item, idx) => <li key={`g-${idx}`}>{item}</li>)
                    ) : (
                      <li>No critical gaps detected for this round.</li>
                    )}
                  </ul>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <h4 className="text-xs uppercase tracking-widest text-indigo-300 font-bold mb-3">Steps To Improve</h4>
                  <ul className="space-y-2 text-sm text-slate-200 list-disc pl-5">
                    {finalSummary.improvementSteps.length > 0 ? (
                      finalSummary.improvementSteps.map((item, idx) => <li key={`i-${idx}`}>{item}</li>)
                    ) : (
                      <li>Repeat one mock round to reinforce retention.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
