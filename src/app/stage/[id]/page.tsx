"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PlayCircle, BrainCircuit, ArrowLeft, Send, Sparkles, CheckCircle2, AlertTriangle, ShieldAlert, BookOpen } from "lucide-react";

import { completeStageMentorshipTasks, getAssessmentInterval, getStageBand, normalizeLevel, type SkillLevel } from "@/lib/mentorshipPlan";

type VideoHit = {
  title: string;
  url: string;
  embedUrl: string | null;
  source: "youtube" | "web";
};

type EvaluationFeedback = {
  evaluation?: string;
  evaluationScore?: number | null;
  perplexityScore?: number;
  isCheating?: boolean;
  error?: string;
};

type QuizItem = {
  id: string;
  type: "mcq" | "descriptive";
  question: string;
  options?: string[];
};

type QuizPayload = {
  quiz?: string;
  quizItems?: QuizItem[];
  followUps?: string[];
  optimizationHint?: string;
  mode?: string;
};

function extractYouTubeIdFromEmbedUrl(embedUrl: string | null | undefined): string {
  const raw = typeof embedUrl === "string" ? embedUrl.trim() : "";
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    const embedIdx = parts.indexOf("embed");
    if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1].trim();
    return "";
  } catch {
    return "";
  }
}

function useLocalStorageItem(key: string): string | null {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") return () => undefined;
      window.addEventListener("storage", callback);
      return () => window.removeEventListener("storage", callback);
    },
    () => {
      if (typeof window === "undefined") return null;
      return window.localStorage.getItem(key);
    },
    () => null
  );
}

export default function StageView() {
  const params = useParams();
  const router = useRouter();
  
  const stageId = typeof params.id === "string" ? params.id : "";
  const storedTopic = useLocalStorageItem("study.topic") ?? "";
  const storedLevel = useLocalStorageItem("study.level") ?? "Medium";
  const storedRoadmapJson = useLocalStorageItem("study.roadmap");
  const storedPlanJson = useLocalStorageItem("study.plan");
  const selectedLevel = useMemo<SkillLevel>(() => normalizeLevel(storedLevel), [storedLevel]);

  const roadmapStages = useMemo(() => {
    if (!storedRoadmapJson) return [] as Array<{ id: string; title: string }>;
    try {
      const parsed = JSON.parse(storedRoadmapJson) as Array<{ id?: unknown; title?: unknown }>;
      return (Array.isArray(parsed) ? parsed : [])
        .filter((s) => typeof s?.id === "string" && typeof s?.title === "string")
        .map((s) => ({ id: s.id as string, title: s.title as string }));
    } catch {
      return [] as Array<{ id: string; title: string }>;
    }
  }, [storedRoadmapJson]);

  const stageTitle = useMemo(() => {
    const found = roadmapStages.find((s) => s.id === stageId);
    return found?.title?.trim() ? found.title : "Core Fundamentals & Logic";
  }, [roadmapStages, stageId]);

  const planStageIds = useMemo(() => {
    if (!storedPlanJson) return [] as string[];
    try {
      const parsed = JSON.parse(storedPlanJson) as { stageIds?: unknown };
      return Array.isArray(parsed.stageIds)
        ? (parsed.stageIds.filter((x) => typeof x === "string") as string[])
        : [];
    } catch {
      return [] as string[];
    }
  }, [storedPlanJson]);

  const roundIndex = useMemo(() => {
    if (!stageId || planStageIds.length === 0) return null;
    const idx = planStageIds.indexOf(stageId);
    return idx >= 0 ? idx : null;
  }, [planStageIds, stageId]);

  const roundTotal = planStageIds.length > 0 ? planStageIds.length : null;
  const stageNumber = useMemo(() => {
    const fromId = Number(stageId.split("-")[1]);
    if (Number.isFinite(fromId) && fromId > 0) return fromId;
    return typeof roundIndex === "number" ? roundIndex + 1 : 1;
  }, [stageId, roundIndex]);
  const stageBand = getStageBand(stageNumber);
  const sessionNumber = typeof roundIndex === "number" ? roundIndex + 1 : 1;
  const assessmentEvery = getAssessmentInterval(selectedLevel);
  const isPeriodicAssessment = sessionNumber % assessmentEvery === 0;

  const effectiveTopic = useMemo(() => {
    const t = storedTopic.trim();
    if (t) return t;
    const s = stageTitle.trim();
    if (s) return s;
    return "General";
  }, [storedTopic, stageTitle]);
  const [activeTab, setActiveTab] = useState<"learn" | "practice">("learn");
  const [quizQuestion, setQuizQuestion] = useState("");
  const [quizItems, setQuizItems] = useState<QuizItem[]>([]);
  const [answersMap, setAnswersMap] = useState<Record<string, string>>({});
  const [answer, setAnswer] = useState("");
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [feedback, setFeedback] = useState<EvaluationFeedback | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [optimizationHint, setOptimizationHint] = useState("");
  const [practiceModeLabel, setPracticeModeLabel] = useState("Practice session");
  const [attemptCount, setAttemptCount] = useState(0);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantReply, setAssistantReply] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [oaSessionId, setOaSessionId] = useState<string | null>(null);

  const [videos, setVideos] = useState<VideoHit[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = extractYouTubeIdFromEmbedUrl(videos[selectedVideoIndex]?.embedUrl);
    if (!id) return;
    try {
      window.localStorage.setItem("lastLearnVideoId", id);
      if (effectiveTopic) window.localStorage.setItem("lastLearnTopic", effectiveTopic);
      if (stageTitle) window.localStorage.setItem("lastLearnStage", stageTitle);
    } catch {
      // ignore
    }
  }, [videos, selectedVideoIndex, effectiveTopic, stageTitle]);

  const oaSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    oaSessionIdRef.current = oaSessionId;
  }, [oaSessionId]);

  const loadQuiz = async () => {
    setActiveTab("practice");
    if (quizQuestion) return;
    setLoadingQuiz(true);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: effectiveTopic,
          level: selectedLevel,
          sessionNumber,
          mode: isPeriodicAssessment ? "assessment" : "practice",
        })
      });
      const data = (await res.json()) as QuizPayload;
      setQuizQuestion(data.quiz || "What are the core principles of this topic?");
      setQuizItems(data.quizItems || []);
      setAnswersMap({});
      setFollowUps(Array.isArray(data.followUps) ? data.followUps.filter((x) => typeof x === "string") : []);
      setOptimizationHint(typeof data.optimizationHint === "string" ? data.optimizationHint : "");
      setPracticeModeLabel(typeof data.mode === "string" ? data.mode : (isPeriodicAssessment ? "Retention checkpoint" : "Practice session"));

      // Start OA session once we have a question
      const question = data.quiz || "What are the core principles of this topic?";
      const oaRes = await fetch("/api/oa/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: effectiveTopic, question }),
      });
      const oaData = await oaRes.json();
      if (oaRes.ok && typeof oaData.sessionId === "string") {
        setOaSessionId(oaData.sessionId);
      }
    } catch {
      setQuizQuestion("Mock Question: Explain the core mechanics underlying this stage's concepts.");
    }
    setLoadingQuiz(false);
  };

  const handleEvaluate = async () => {
    let serializedAnswers = answer;
    if (quizItems && quizItems.length > 0) {
        serializedAnswers = quizItems.map(q => `Q: ${q.question}\nA: ${answersMap[q.id] || "No answer provided."}`).join("\n\n");
    }

    if (!serializedAnswers.trim()) return;
    setEvaluating(true);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: serializedAnswers, context: quizQuestion, sessionId: oaSessionIdRef.current })
      });
      const data = await res.json();
      setFeedback(data);
      setAttemptCount((prev) => prev + 1);

      const score = typeof data.evaluationScore === "number" ? Math.max(0, Math.min(100, data.evaluationScore)) : null;
      const rating = score === null ? undefined : Math.round((score / 20) * 10) / 10;
      completeStageMentorshipTasks(stageId, {
        includePractice: true,
        includeAssessment: isPeriodicAssessment,
        feedback: typeof data.evaluation === "string" ? data.evaluation : undefined,
        rating,
      });

      if (typeof score === "number" && score < 60) {
        setAssistantReply("You are close. Focus on concept -> example -> trade-off. Start by defining the concept in one sentence, then apply it to this stage, and finally mention one optimization with a risk.");
      }
    } catch (err) {
      console.error(err);
    }
    setEvaluating(false);
  };

  const requestAssistantGuidance = async () => {
    const question = assistantPrompt.trim();
    if (!question) return;
    setAssistantLoading(true);
    try {
      const prompt = [
        `You are a mentorship assistant for stage learning.`,
        `Topic: ${effectiveTopic}`,
        `Stage: ${stageTitle}`,
        `Level: ${selectedLevel}`,
        `Session: ${sessionNumber}`,
        `User question: ${question}`,
        "Respond with concise guidance in exactly 3 bullet points and one tiny practice task.",
      ].join("\n");

      const res = await fetch("/api/stage/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json().catch(() => ({}));
      const text = typeof (data as { generated_text?: unknown }).generated_text === "string"
        ? (data as { generated_text: string }).generated_text.trim()
        : "";

      setAssistantReply(text || "1. Break the concept into smaller steps.\n2. Solve one example manually.\n3. Explain your solution out loud.\nTiny task: write a 5-line summary and one optimization idea.");
    } catch {
      setAssistantReply("1. Focus on one concept at a time.\n2. Practice with one structured example.\n3. Compare a basic and optimized solution.\nTiny task: write one short answer with concept, example, and trade-off.");
    } finally {
      setAssistantLoading(false);
    }
  };

  const navigateAfterRound = async (target: string) => {
    const id = oaSessionIdRef.current;
    if (id) {
      fetch("/api/oa/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
        keepalive: true,
      }).catch(() => undefined);
    }
    router.push(target);
  };

  // close OA session on page navigation/unmount
  useEffect(() => {
    const handler = () => {
      const id = oaSessionIdRef.current;
      if (!id) return;
      fetch("/api/oa/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
        keepalive: true,
      }).catch(() => undefined);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handler);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", handler);
      }
      handler();
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "learn") return;

    let cancelled = false;
    setVideoLoading(true);
    setVideoError(null);
    setVideos([]);
    setSelectedVideoIndex(0);

    (async () => {
      try {
        const res = await fetch("/api/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: storedTopic.trim() || effectiveTopic, stageTitle }),
        });
        const data = (await res.json()) as unknown;
        if (!res.ok) {
          const message =
            typeof (data as { error?: unknown } | null)?.error === "string"
              ? (data as { error: string }).error
              : "Failed to load videos";
          throw new Error(message);
        }

        const list = (data as { videos?: unknown } | null)?.videos;
        const parsed: VideoHit[] = Array.isArray(list)
          ? (list.filter(
              (v): v is VideoHit =>
                v &&
                typeof v === "object" &&
                typeof (v as VideoHit).title === "string" &&
                typeof (v as VideoHit).url === "string" &&
                (typeof (v as VideoHit).embedUrl === "string" || (v as VideoHit).embedUrl === null)
            ) as VideoHit[])
          : [];

        if (!cancelled) setVideos(parsed);
      } catch (e) {
        if (cancelled) return;
        setVideoError(e instanceof Error ? e.message : "Failed to load videos");
      } finally {
        if (!cancelled) setVideoLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, effectiveTopic, stageTitle, storedTopic]);

  const assistanceChecklist = useMemo(() => {
    const levelTip =
      selectedLevel === "Easy"
        ? "Break this stage into two short sessions and focus on one concept at a time."
        : selectedLevel === "Hard"
          ? "Push for one optimized implementation and one trade-off analysis."
          : "Balance concept understanding with one practical implementation.";

    return [
      `Band target: ${stageBand} progression for ${effectiveTopic}.`,
      `Session ${sessionNumber}: ${isPeriodicAssessment ? "retention assessment" : "practice"} mode active.`,
      levelTip,
      "Use the format: concept -> example -> optimization trade-off.",
    ];
  }, [selectedLevel, stageBand, effectiveTopic, sessionNumber, isPeriodicAssessment]);

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] overflow-x-hidden selection:bg-cyan-500/30">
      {/* Background ambient light */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-3/4 h-[400px] bg-cyan-900/10 blur-[120px] rounded-full pointer-events-none" />

      <main className="max-w-7xl mx-auto relative z-10 px-6 py-10 space-y-8">
        
        {/* Navigation & Header */}
        <button 
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors group font-semibold"
        >
          <ArrowLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
          <span className="text-lg">Map</span>
        </button>

        <header className="flex flex-col md:flex-row md:items-end justify-between border-b border-white/5 pb-8 gap-6">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-4 py-1.5 rounded-full text-sm font-black uppercase tracking-widest shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                {typeof roundIndex === "number" && typeof roundTotal === "number"
                  ? `OA Round ${roundIndex + 1}/${roundTotal}`
                  : `Stage ${stageId.split("-")[1] || "1"}`}
              </span>
              <span className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-4 py-1.5 rounded-full text-sm font-black uppercase tracking-widest">
                {selectedLevel} • {stageBand}
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
              {stageTitle}
            </h1>
            <p className="text-slate-400 mt-4 text-xl">Master the essential building blocks to advance.</p>
          </motion.div>
          
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
            <div className="flex bg-slate-900/50 border border-white/10 rounded-2xl p-1.5 shadow-2xl backdrop-blur-sm">
              <button 
                onClick={() => setActiveTab("learn")}
                className={`flex items-center gap-3 px-8 py-4 rounded-xl text-base font-bold transition-all ${activeTab === "learn" ? "bg-cyan-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)]" : "text-slate-400 hover:text-white"}`}
              >
                <PlayCircle className="w-5 h-5" /> Learn
              </button>
              <button 
                onClick={loadQuiz}
                className={`flex items-center gap-3 px-8 py-4 rounded-xl text-base font-bold transition-all ${activeTab === "practice" ? "bg-cyan-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)]" : "text-slate-400 hover:text-white"}`}
              >
                <BrainCircuit className="w-5 h-5" /> Practice Area
              </button>
            </div>

            <button
              onClick={() => {
                const id = extractYouTubeIdFromEmbedUrl(videos[selectedVideoIndex]?.embedUrl);
                const suffix = id ? `&videoId=${encodeURIComponent(id)}` : "";
                router.push(`/interview?topic=${encodeURIComponent(effectiveTopic)}${suffix}`);
              }}
              className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white font-bold px-8 py-4 rounded-2xl shadow-[0_0_20px_rgba(99,102,241,0.25)] transition hover:scale-[1.02] active:scale-[0.99]"
            >
              Interview
            </button>
          </motion.div>
        </header>

        {/* Content Area */}
        <motion.div 
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full"
        >
          {activeTab === "learn" ? (
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Left Col */}
              <div className="lg:col-span-2 space-y-8">
                <div className="glass-panel rounded-3xl overflow-hidden">
                  <div className="relative aspect-video bg-black/40">
                    {videoLoading ? (
                      <div className="absolute inset-0 animate-pulse bg-white/5" />
                    ) : videos[selectedVideoIndex]?.embedUrl ? (
                      <iframe
                        title={videos[selectedVideoIndex]?.title || "Video"}
                        src={videos[selectedVideoIndex]?.embedUrl || undefined}
                        className="absolute inset-0 w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center space-y-2">
                          <p className="text-slate-300 font-bold">
                            {videoError ? "Video search failed" : "No embeddable video found"}
                          </p>
                          <p className="text-slate-500 text-sm">
                            {videoError ? videoError : "Try Practice, or open a result below."}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-6 border-t border-white/5 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-base font-bold text-white line-clamp-1">
                          {videos[selectedVideoIndex]?.title || (videoLoading ? "Searching videos…" : "Video")}
                        </p>
                        {videoError && <p className="text-sm text-red-400 mt-1">{videoError}</p>}
                      </div>
                      {videos[selectedVideoIndex]?.url && (
                        <a
                          href={videos[selectedVideoIndex].url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-bold text-cyan-400 hover:text-cyan-300"
                        >
                          Open
                        </a>
                      )}
                    </div>

                    {videos.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        {videos.map((v, idx) => (
                          <button
                            key={`${v.url}-${idx}`}
                            onClick={() => setSelectedVideoIndex(idx)}
                            className={`px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${
                              idx === selectedVideoIndex
                                ? "bg-cyan-600/20 text-cyan-300 border-cyan-500/30"
                                : "bg-black/20 text-slate-400 border-white/10 hover:text-white"
                            }`}
                          >
                            {idx + 1}. {v.source === "youtube" ? "YouTube" : "Web"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="glass-panel rounded-3xl p-8">
                  <h3 className="flex items-center gap-3 text-2xl font-bold mb-6 text-cyan-300">
                    <BookOpen className="w-6 h-6" /> AI Generated Summary
                  </h3>
                  <div className="space-y-4 text-slate-300 leading-relaxed font-medium text-lg">
                    <p>Based on the RAG pipeline analysis from the top performing metrics, the core principles revolve around understanding deep abstractions and structural nodes.</p>
                    <ul className="list-disc pl-6 space-y-4 text-slate-400">
                      <li>Always confirm the constraints before implementing logic structures.</li>
                      <li>Complexity analysis represents the foundational boundary of operations.</li>
                      <li>Consider edge cases: Empty inputs, infinite loops, memory leaks.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Right Col */}
              <div className="flex flex-col space-y-8">
                {/* Assistant Chat */}
                <div className="glass-panel flex-1 rounded-3xl p-6 flex flex-col">
                  <h3 className="flex items-center gap-3 text-xl font-bold mb-6 text-indigo-300">
                    <Sparkles className="w-6 h-6" /> Stage Assistant
                  </h3>
                  <div className="flex-1 space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Guidance Checklist</p>
                      <ul className="space-y-2 text-sm text-slate-300 list-disc pl-5">
                        {assistanceChecklist.map((item, idx) => (
                          <li key={`assist-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    {assistantReply ? (
                      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                        <p className="text-sm whitespace-pre-line text-indigo-100">{assistantReply}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col justify-center items-center text-center opacity-60 py-4">
                        <Sparkles className="w-12 h-12 mb-3 text-indigo-500/50" />
                        <p className="text-sm">Ask for hints if you are stuck on this stage.</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-6 relative">
                    <input 
                      value={assistantPrompt}
                      onChange={(e) => setAssistantPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void requestAssistantGuidance();
                      }}
                      placeholder="Type a question..." 
                      className="w-full bg-black/40 border border-white/10 rounded-2xl pl-6 pr-16 py-5 text-base focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                    />
                    <button
                      onClick={() => void requestAssistantGuidance()}
                      disabled={assistantLoading || !assistantPrompt.trim()}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 rounded-xl transition-colors disabled:opacity-50"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-8">

              <div className="glass-panel rounded-3xl p-8 md:p-12 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <BrainCircuit className="w-64 h-64" />
                </div>
                
                <h2 className="text-3xl font-bold mb-10 flex items-center justify-between relative z-10">
                  <span>{isPeriodicAssessment ? "Knowledge Assessment" : "Practice Session"}</span>
                  {feedback && (
                     <span className={`text-base px-5 py-2.5 rounded-full border font-black ${
                       feedback.isCheating ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                     }`}>
                       Score: {typeof feedback.evaluationScore === 'number' ? `${feedback.evaluationScore}/100` : "N/A"}
                     </span>
                  )}
                </h2>

                <div className="space-y-8 relative z-10">
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-xs uppercase tracking-widest font-bold text-cyan-300">
                    {practiceModeLabel} • Level {selectedLevel} • Session {sessionNumber}
                  </div>
                  <div className="text-xs text-slate-500">Attempts in this stage: {attemptCount}</div>

                  {loadingQuiz ? (
                    <div className="animate-pulse space-y-4">
                       <div className="h-8 bg-white/10 rounded w-3/4"></div>
                       <div className="h-8 bg-white/10 rounded w-1/2"></div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {quizItems && quizItems.length > 0 ? (
                        <div className="space-y-8">
                          {quizItems.map((item) => (
                            <div key={item.id} className="text-xl text-slate-200 leading-relaxed bg-black/40 p-8 border border-white/5 rounded-2xl">
                              <p className="mb-4 whitespace-pre-wrap">{item.question}</p>
                              {item.type === "mcq" && item.options ? (
                                <div className="flex flex-col gap-3 mt-6">
                                  {item.options.map((opt, i) => (
                                    <label key={i} className="flex items-start gap-4 cursor-pointer p-4 rounded-xl border border-white/10 hover:bg-white/5 transition-colors">
                                      <input 
                                        type="radio" 
                                        name={item.id} 
                                        value={opt} 
                                        checked={answersMap[item.id] === opt} 
                                        onChange={() => setAnswersMap(prev => ({ ...prev, [item.id]: opt }))}
                                        className="mt-1.5 w-5 h-5 text-cyan-500 bg-black/50 border-white/20 focus:ring-cyan-500 focus:ring-offset-gray-900"
                                      />
                                      <span className="text-lg text-slate-300">{opt}</span>
                                    </label>
                                  ))}
                                </div>
                              ) : (
                                <textarea
                                  value={answersMap[item.id] || ""}
                                  onChange={(e) => setAnswersMap(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  placeholder="Type your descriptive answer here..."
                                  className="w-full mt-4 h-32 p-6 bg-black/20 border border-white/10 rounded-xl text-slate-200 focus:ring-1 focus:ring-cyan-500 outline-none resize-none font-mono"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xl md:text-2xl text-slate-200 leading-relaxed bg-black/40 p-8 border border-white/5 rounded-2xl whitespace-pre-wrap">
                          {quizQuestion}
                        </div>
                      )}
                      {followUps.length > 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                          <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-3">Follow-up Questions</p>
                          <ul className="space-y-2 text-sm text-slate-300 list-disc pl-5">
                            {followUps.map((item, idx) => <li key={`fu-${idx}`}>{item}</li>)}
                          </ul>
                        </div>
                      ) : null}
                      {optimizationHint ? (
                        <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
                          <span className="font-bold">Optimization Hint:</span> {optimizationHint}
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                    Microphone not working? Continue with text-based practice here. Your answer will still be assessed and tracked.
                  </div>

                  {(!quizItems || quizItems.length === 0) && (
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Type your detailed answer here... (Anti-cheat is actively monitoring)"
                      className="w-full h-56 bg-black/40 border border-white/10 rounded-2xl p-8 text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 resize-none font-mono text-base leading-relaxed"
                    />
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={handleEvaluate}
                      disabled={evaluating || (!answer.trim() && Object.keys(answersMap).length === 0)}
                      className="bg-gradient-to-r from-cyan-600 to-indigo-600 text-white font-bold py-5 px-12 text-lg rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.4)] transform transition hover:scale-105 active:scale-95 disabled:opacity-50 flex items-center gap-3"
                    >
                      {evaluating ? "Evaluating Context..." : "Submit Answer"}
                      <Send className="w-6 h-6" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Feedback Alert */}
              <AnimatePresence>
                {feedback && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    className={`p-8 rounded-3xl border ${
                      feedback.isCheating ? "glass-panel bg-red-950/20 border-red-500/30" : "glass-panel bg-emerald-950/20 border-emerald-500/30"
                    }`}
                  >
                    <h3 className={`text-xl font-bold flex items-center gap-3 mb-4 ${
                      feedback.isCheating ? "text-red-400" : "text-emerald-400"
                    }`}>
                      {feedback.isCheating ? <ShieldAlert className="w-6 h-6"/> : <CheckCircle2 className="w-6 h-6"/>}
                      {feedback.isCheating ? "AI Generation / Anomaly Detected" : "Human Response Validated"}
                    </h3>
                    
                    <div className="flex flex-col md:flex-row gap-8 items-start">
                      {typeof feedback.evaluationScore === "number" && (
                        <div className="relative flex-shrink-0 flex items-center justify-center w-32 h-32 bg-black/40 rounded-full border border-white/5 shadow-inner">
                          <svg height="120" width="120" className="transform -rotate-90">
                            <circle
                              stroke="rgba(255,255,255,0.1)"
                              fill="transparent"
                              strokeWidth="8"
                              r="50"
                              cx="60"
                              cy="60"
                            />
                            <circle
                              stroke={feedback.evaluationScore > 75 ? "#10b981" : feedback.evaluationScore > 50 ? "#eab308" : "#ef4444"}
                              fill="transparent"
                              strokeWidth="8"
                              strokeLinecap="round"
                              strokeDasharray={314.159}
                              strokeDashoffset={314.159 - (feedback.evaluationScore / 100) * 314.159}
                              r="50"
                              cx="60"
                              cy="60"
                              className="transition-all duration-1000 ease-out"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-black text-white">{feedback.evaluationScore}</span>
                            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Score</span>
                          </div>
                        </div>
                      )}
                      
                      <div className="text-slate-300 font-medium leading-relaxed flex-1 bg-black/20 p-6 rounded-2xl border border-white/5">
                        <div className="space-y-2">
                          {(feedback.evaluation || feedback.error || "No evaluation returned.").split('\n').map((line, i) => {
                            const trimmed = line.trim();
                            if (!trimmed) return null;
                            if (trimmed.includes('What is Correct:') || trimmed.includes('Correct:')) {
                              return <p key={i} className="text-emerald-400 font-semibold mt-4">{line}</p>;
                            }
                            if (trimmed.includes('What is Wrong') || trimmed.includes('Wrong/Missing:')) {
                              return <p key={i} className="text-red-400 font-semibold mt-4">{line}</p>;
                            }
                            if (trimmed.includes('Score:')) {
                              return <p key={i} className="text-cyan-400 font-bold text-lg mb-2">{line}</p>;
                            }
                            if (trimmed.startsWith('-')) {
                              return <p key={i} className="pl-4 border-l-2 border-white/10 my-1 text-slate-400">{line}</p>;
                            }
                            return <p key={i} className="text-slate-300">{line}</p>;
                          })}
                        </div>
                      </div>
                    </div>
                    
                    {feedback.isCheating && (
                      <div className="mt-6 p-5 bg-red-950/50 border border-red-500/20 rounded-2xl flex items-start gap-4">
                        <AlertTriangle className="w-6 h-6 text-red-500 mt-1" />
                        <div>
                          <p className="text-red-200 font-bold mb-1">Strict Warning Logged</p>
                          <p className="text-red-400/80 text-sm">
                            Perplexity: {typeof feedback.perplexityScore === 'number' ? feedback.perplexityScore.toFixed(2) : 'N/A'}. Continuous low perplexity combined with tab-switching will result in stage lock.
                          </p>
                        </div>
                      </div>
                    )}

                    {typeof roundIndex === "number" && typeof roundTotal === "number" && feedback && (
                      <div className="mt-8 flex justify-end">
                        {roundIndex + 1 < roundTotal ? (
                          <button
                            onClick={async () => {
                              const nextId = planStageIds[roundIndex + 1];
                              if (nextId) await navigateAfterRound(`/stage/${nextId}`);
                            }}
                            className="bg-gradient-to-r from-cyan-600 to-indigo-600 text-white font-bold py-4 px-10 text-base rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.3)] transition hover:scale-105 active:scale-95"
                          >
                            Next OA Round
                          </button>
                        ) : (
                          <button
                            onClick={() => navigateAfterRound(`/interview?topic=${encodeURIComponent(effectiveTopic)}&proctor=1`)}
                            className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white font-bold py-4 px-10 text-base rounded-xl shadow-[0_0_20px_rgba(99,102,241,0.25)] transition hover:scale-105 active:scale-95"
                          >
                            Final Interview
                          </button>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
