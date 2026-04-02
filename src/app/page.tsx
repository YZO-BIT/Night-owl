"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Sparkles, BookOpen, Route, Loader2 } from "lucide-react";

type RoadmapStage = {
  id: string;
  title: string;
  objectives: string;
  difficulty: string;
};

type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export default function Home() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [roadmap, setRoadmap] = useState<RoadmapStage[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        setAuthUser((data as { user?: AuthUser | null }).user ?? null);
      } catch {
        if (!active) return;
        setAuthUser(null);
      } finally {
        if (!active) return;
        setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAuthUser(null);
      router.refresh();
    }
  };

  const handleGenerate = async () => {
    if (!authLoading && !authUser) {
      router.push("/login");
      return;
    }
    if (!topic.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const stages: RoadmapStage[] = (data.roadmap as RoadmapStage[] | undefined) || [];
      setRoadmap(stages);

      try {
        localStorage.setItem("study.topic", topic);
        localStorage.setItem("study.roadmap", JSON.stringify(stages));
        localStorage.setItem(
          "study.plan",
          JSON.stringify({
            topic,
            stageIds: stages.slice(0, 6).map((s) => s.id),
            createdAt: new Date().toISOString(),
          })
        );
      } catch {
        // ignore storage failures (private mode, etc.)
      }
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 overflow-x-hidden selection:bg-cyan-500/30">
      
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 -left-1/4 w-[800px] h-[800px] bg-cyan-900/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-1/4 -right-1/4 w-[800px] h-[800px] bg-indigo-900/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      {/* Navbar */}
      <nav className="relative z-50 flex items-center justify-between p-6 md:px-12 backdrop-blur-md border-b border-white/5">
        <div onClick={() => setRoadmap([])} className="flex items-center gap-3 cursor-pointer group">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-indigo-600 rounded-xl group-hover:scale-110 transition-transform">
            <Route className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Aura Learning
          </span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-base font-medium text-slate-400 hover:text-white cursor-pointer transition-colors">Dashboard</span>
          {authLoading ? null : authUser ? (
            <div className="flex items-center gap-3">
              <button
                onClick={handleLogout}
                className="px-5 py-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-bold text-slate-200"
              >
                Logout
              </button>
              <div className="w-12 h-12 rounded-full border border-white/10 bg-slate-900 flex items-center justify-center">
                <img
                  src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"
                  alt="avatar"
                  className="w-10 h-10 rounded-full"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/login")}
                className="px-5 py-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-bold text-slate-200"
              >
                Login
              </button>
              <button
                onClick={() => router.push("/register")}
                className="px-5 py-2.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors text-sm font-bold text-cyan-300"
              >
                Register
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-20 flex flex-col items-center">
        
        <AnimatePresence mode="wait">
          {roadmap.length === 0 ? (
            <motion.div 
              key="onboarding"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="w-full max-w-3xl flex flex-col items-center gap-12 mt-10"
            >
              <div className="text-center space-y-6">
                <motion.div 
                  initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-base font-semibold tracking-wide"
                >
                  <Sparkles className="w-5 h-5" /> AI-Powered Curriculum
                </motion.div>
                <h1 className="text-6xl md:text-8xl font-extrabold tracking-tight leading-tight">
                  What do you want <br className="hidden md:block"/> to master today?
                </h1>
                <p className="text-slate-400 text-xl md:text-2xl max-w-3xl mx-auto leading-relaxed">
                  Enter any topic. Our AI generates a comprehensive, gamified syllabus tailored directly to the highest industry standards.
                </p>
              </div>

              <div className="w-full relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-3xl blur opacity-25 group-focus-within:opacity-50 transition duration-1000"></div>
                <div className="relative glass-panel rounded-3xl p-2 flex items-center shadow-2xl">
                  <div className="pl-6 pr-2">
                    <Search className="w-6 h-6 text-cyan-400" />
                  </div>
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                    placeholder="e.g. Advanced System Design, Calculus, Python..."
                    className="flex-1 bg-transparent border-none text-xl text-white placeholder-slate-500 focus:outline-none py-6 px-4"
                  />
                  <button 
                    onClick={handleGenerate}
                    disabled={loading || !topic}
                    className="bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-lg font-bold px-10 py-5 rounded-2xl flex items-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95"
                  >
                    {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Initialize Quest"}
                  </button>
                </div>
              </div>

              {/* Suggestions */}
              <div className="flex flex-wrap items-center justify-center gap-4 mt-8">
                <span className="text-base text-slate-500 font-medium">Trending Paths:</span>
                {["React Internals", "Machine Learning", "Cloud Architecture"].map((preset) => (
                  <button key={preset} onClick={() => setTopic(preset)} className="px-6 py-2.5 rounded-full border border-white/10 hover:border-cyan-500/50 bg-white/5 hover:bg-cyan-500/10 transition-colors text-base font-medium text-slate-300">
                    {preset}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="roadmap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
              className="w-full max-w-5xl"
            >
              <div className="text-center mb-20">
                <h2 className="text-5xl md:text-7xl font-extrabold mb-6">{topic} Mastery</h2>
                <p className="text-slate-400 text-xl md:text-2xl">Your personalized journey through the core fundamentals and advanced node graphs.</p>

                <div className="mt-10 flex justify-center">
                  <button
                    onClick={() => {
                      const firstId = roadmap?.[0]?.id;
                      if (firstId) router.push(`/stage/${firstId}`);
                    }}
                    className="bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-lg font-bold px-10 py-5 rounded-2xl flex items-center gap-3 transition-all transform active:scale-95"
                  >
                    Start OA Round 1
                  </button>
                </div>
              </div>

              <div className="relative">
                {/* Connecting Line */}
                <div className="absolute top-0 bottom-0 left-12 md:left-1/2 w-1 bg-white/10 -ml-[2px]" />

                <div className="space-y-12">
                  {roadmap.map((stage, i) => {
                    const isLeft = i % 2 === 0;
                    return (
                      <div key={i} className={`relative flex items-center md:justify-between w-full ${isLeft ? 'flex-row-reverse' : ''}`}>
                        
                        {/* Empty Space for desktop alternation */}
                        <div className="hidden md:block w-5/12" />

                        {/* Center Node */}
                        <motion.div 
                          initial={{ scale: 0 }} 
                          animate={{ scale: 1 }} 
                          transition={{ delay: i * 0.1, type: "spring" }}
                          className="absolute left-12 md:left-1/2 -ml-6 w-12 h-12 rounded-full border-4 border-[#0a0a0f] bg-gradient-to-r from-cyan-500 to-indigo-500 flex items-center justify-center z-10 glow-cyan shadow-xl cursor-pointer hover:scale-110 transition-transform"
                          onClick={() => router.push(`/stage/${stage.id}`)}
                        >
                          <BookOpen className="w-5 h-5 text-white" />
                        </motion.div>

                        {/* Content Card */}
                        <motion.div 
                          initial={{ opacity: 0, x: isLeft ? 50 : -50 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.15 + 0.2 }}
                          onClick={() => router.push(`/stage/${stage.id}`)}
                          className="w-full md:w-5/12 pl-28 md:pl-0 pr-0"
                        >
                          <div className={`glass-panel p-8 rounded-3xl hover:bg-white-[0.05] transition-all cursor-pointer group ${isLeft ? 'hover:border-cyan-500/50' : 'hover:border-indigo-500/50'}`}>
                            <div className="flex items-center gap-3 mb-3">
                              <span className={`text-sm font-bold uppercase tracking-widest ${isLeft ? 'text-cyan-400' : 'text-indigo-400'}`}>
                                Stage 0{i + 1}
                              </span>
                            </div>
                            <h3 className="text-3xl font-bold mb-4 group-hover:text-white transition-colors">{stage.title}</h3>
                            <p className="text-slate-400 text-base leading-relaxed">Dive into the core protocols and essential architectural patterns necessary to clear this boundary.</p>
                          </div>
                        </motion.div>
                        
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
