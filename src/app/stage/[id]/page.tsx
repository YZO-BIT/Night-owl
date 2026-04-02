"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PlayCircle, BrainCircuit, ArrowLeft, Send, Sparkles, CheckCircle2, AlertTriangle, ShieldAlert, BookOpen, Activity } from "lucide-react";
import FocusMonitor from "@/components/FocusMonitor";

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
  const storedRoadmapJson = useLocalStorageItem("study.roadmap");
  const storedPlanJson = useLocalStorageItem("study.plan");

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

  const effectiveTopic = useMemo(() => {
    const t = storedTopic.trim();
    if (t) return t;
    const s = stageTitle.trim();
    if (s) return s;
    return "General";
  }, [storedTopic, stageTitle]);
  const [activeTab, setActiveTab] = useState<"learn" | "practice">("learn");
  const [quizQuestion, setQuizQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [feedback, setFeedback] = useState<EvaluationFeedback | null>(null);
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
        body: JSON.stringify({ topic: effectiveTopic })
      });
      const data = await res.json();
      setQuizQuestion(data.quiz || "What are the core principles of this topic?");

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
    if (!answer.trim()) return;
    setEvaluating(true);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: answer, context: quizQuestion, sessionId: oaSessionId })
      });
      const data = await res.json();
      setFeedback(data);
    } catch (err) {
      console.error(err);
    }
    setEvaluating(false);
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
  }, [activeTab, effectiveTopic]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 overflow-x-hidden selection:bg-cyan-500/30">
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
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
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
                router.push(`/interview?topic=${encodeURIComponent(effectiveTopic)}&proctor=1${suffix}`);
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
                  <div className="flex-1 flex flex-col justify-center items-center text-center opacity-60">
                    <Sparkles className="w-16 h-16 mb-4 text-indigo-500/50" />
                    <p className="text-base">I&apos;m here to help clarify any concepts from this stage. Ask me anything.</p>
                  </div>
                  <div className="mt-6 relative">
                    <input 
                      placeholder="Type a question..." 
                      className="w-full bg-black/40 border border-white/10 rounded-2xl pl-6 pr-16 py-5 text-base focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                    />
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 rounded-xl transition-colors">
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-8">
              {oaSessionId ? <FocusMonitor oaSessionId={oaSessionId} /> : null}
              <div className="glass-panel rounded-3xl p-8 md:p-12 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <BrainCircuit className="w-64 h-64" />
                </div>
                
                <h2 className="text-3xl font-bold mb-10 flex items-center justify-between relative z-10">
                  <span>Knowledge Assessment</span>
                  {feedback && (
                     <span className={`text-base px-5 py-2.5 rounded-full border font-black ${
                       feedback.isCheating ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                     }`}>
                       Score: {typeof feedback.evaluationScore === 'number' ? `${feedback.evaluationScore}/100` : "N/A"}
                     </span>
                  )}
                </h2>

                <div className="space-y-8 relative z-10">
                  {loadingQuiz ? (
                    <div className="animate-pulse space-y-4">
                       <div className="h-8 bg-white/10 rounded w-3/4"></div>
                       <div className="h-8 bg-white/10 rounded w-1/2"></div>
                    </div>
                  ) : (
                    <div className="text-xl md:text-2xl text-slate-200 leading-relaxed bg-black/40 p-8 border border-white/5 rounded-2xl">
                      {quizQuestion}
                    </div>
                  )}

                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Type your detailed answer here... (Anti-cheat is actively monitoring)"
                    className="w-full h-56 bg-black/40 border border-white/10 rounded-2xl p-8 text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 resize-none font-mono text-base leading-relaxed"
                  />

                  <div className="flex justify-end">
                    <button
                      onClick={handleEvaluate}
                      disabled={evaluating || !answer.trim()}
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
                    
                    <div className="text-slate-300 font-medium leading-relaxed">
                      <p>{feedback.evaluation || feedback.error || "No evaluation returned."}</p>
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
