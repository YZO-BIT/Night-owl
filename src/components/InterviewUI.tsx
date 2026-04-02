"use client";

import { useState, useRef } from "react";
import { Mic, Square, Loader2, Bot } from "lucide-react";

export default function InterviewUI({ topic }: { topic: string }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);

      mediaRecorder.onstop = async () => {
        // In this demo flow we don’t upload audio yet; we use a simulated transcript.
        new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudio();
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied", err);
      // Fallback for demo purposes if microphone not available
      setLogs(prev => [...prev, { role: 'user', text: "[Microphone Access Denied - Using Text Fallback for Demo]" }]);
      processAudioMock("Can you explain the complexity of HashMaps?");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Real Flow (Post audio to backend)
  const processAudio = async () => {
    setIsProcessing(true);
    // In a fully heavy implementation, we would send the FormData blob to a python STT like Whisper
    // For now, we simulate transcribed text being sent to LangGraph
    await processAudioMock("This is a simulated transcript from the recorded audio.");
  };

  // Mock Flow hitting the LangGraph Endpoint
  const processAudioMock = async (mockTranscript: string) => {
    setIsProcessing(true);
    setLogs(prev => [...prev, { role: 'user', text: mockTranscript }]);

    try {
      // Hit our FastAPI LangGraph orchestrator remotely
      const res = await fetch("http://127.0.0.1:8000/api/interview_cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: mockTranscript })
      });
      
      const data = await res.json();
      setLogs(prev => [...prev, { role: 'ai', text: data.response_text }]);
      
      // In a real application, data.audio_url would contain the TTS file to play
      console.log("Audio returned at:", data.audio_url);
    } catch {
      setLogs(prev => [...prev, { role: 'ai', text: "Error connecting to LangGraph Backend." }]);
    }
    
    setIsProcessing(false);
  };

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden flex flex-col h-[500px]">
      <h2 className="text-2xl font-bold mb-6 flex items-center justify-between z-10 text-cyan-300">
        AI Voice Interview: {topic}
      </h2>

      {/* Chat Logs */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-6 z-10 pr-2">
        {logs.map((log, i) => (
          <div key={i} className={`flex ${log.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl p-4 ${
              log.role === 'user' 
                ? 'bg-cyan-600/20 border border-cyan-500/30 text-cyan-100' 
                : 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-100'
            }`}>
              {log.role === 'ai' && <Bot className="w-4 h-4 mb-2 text-indigo-400" />}
              <p className="text-sm leading-relaxed">{log.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Controls */}
      <div className="pt-4 border-t border-white/10 flex items-center justify-center gap-4 z-10">
        {isProcessing ? (
          <div className="flex items-center gap-3 text-cyan-400 font-semibold bg-cyan-500/10 px-6 py-3 rounded-full border border-cyan-500/30">
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing via LangGraph...
          </div>
        ) : isRecording ? (
          <button 
            onClick={stopRecording}
            className="flex items-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-500 border border-red-500/50 px-8 py-4 rounded-full font-bold transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)] animate-pulse"
          >
            <Square className="w-5 h-5" /> Stop Recording
          </button>
        ) : (
          <button 
            onClick={startRecording}
            className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-4 rounded-full font-bold transition-all shadow-[0_0_20px_rgba(8,145,178,0.4)] hover:scale-105"
          >
            <Mic className="w-5 h-5" /> Hold to Speak
          </button>
        )}
      </div>

      {/* Decorative */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[600px] bg-cyan-500/5 blur-[150px] rounded-full pointer-events-none" />
    </div>
  );
}
