"use client";
import { useEffect, useRef, useState } from 'react';

type GazeResult = { horizontal: "left" | "center" | "right"; vertical: "up" | "center" | "down" };

type FaceLandmark = { x: number; y: number };
type FaceMeshResults = { multiFaceLandmarks?: FaceLandmark[][] };

type MediaPipeCamera = { start: () => void; stop: () => void };
type MediaPipeFaceMesh = {
  setOptions: (options: Record<string, unknown>) => void;
  onResults: (cb: (results: FaceMeshResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close: () => void;
};

// For browser compatibility, these are often loaded via CDN if the npm package crashes in SSR,
// but we will dynamically import them if window is defined.
export default function FocusMonitor({ oaSessionId }: { oaSessionId?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Initializing Eye Tracker...");
  const [tabSwitches, setTabSwitches] = useState(0);
  const [gazeResult, setGazeResult] = useState<GazeResult>({ horizontal: "center", vertical: "center" });
  const lastSentRef = useRef(0);

  const sendEvent = async (kind: string, payload: unknown) => {
    if (!oaSessionId) return;
    try {
      await fetch("/api/oa/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: oaSessionId, kind, payload }),
        keepalive: true,
      });
    } catch {
      // best-effort
    }
  };

  // 1. Tab Focus Tracking
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitches((prev) => prev + 1);
        void sendEvent("tab_hidden", { ts: new Date().toISOString() });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oaSessionId]);

  useEffect(() => {
    // Throttle high-frequency telemetry to avoid spamming the server
    const now = Date.now();
    if (now - lastSentRef.current < 2000) return;
    lastSentRef.current = now;

    void sendEvent("telemetry", {
      ts: new Date().toISOString(),
      status,
      tabSwitches,
      gaze: gazeResult,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, tabSwitches, gazeResult.horizontal, gazeResult.vertical, oaSessionId]);

  // 2. Load MediaPipe Face Mesh for Iris Tracking
  useEffect(() => {
    let camera: MediaPipeCamera | null = null;
    let faceMesh: MediaPipeFaceMesh | null = null;

    async function initTracker() {
      try {
        const { FaceMesh } = await import('@mediapipe/face_mesh');
        const { Camera } = await import('@mediapipe/camera_utils');

        faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        }) as unknown as MediaPipeFaceMesh;

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true, // Enables Iris tracking (468 -> 478 landmarks)
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        faceMesh.onResults((results: FaceMeshResults) => {
          if (!canvasRef.current || !videoRef.current) return;
          const canvasCtx = canvasRef.current.getContext('2d');
          if (!canvasCtx) return;

          canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            setStatus("Tracking Active");

            // LEFT EYE IRIS Center (Landmark 468)
            // RIGHT EYE IRIS Center (Landmark 473)
            // Left Eye Boundaries: 33 (outer), 133 (inner)
            // Right Eye Boundaries: 362 (inner), 263 (outer)

            const leftIris = landmarks[468];
            const leftEyeInner = landmarks[133];
            const leftEyeOuter = landmarks[33];

            // Normalize X position to determine horizontal gaze
            const eyeWidth = leftEyeOuter.x - leftEyeInner.x;
            // Handle division by zero edge cases
            if (Math.abs(eyeWidth) > 0.001) {
              const irisRelativeX = (leftIris.x - leftEyeInner.x) / eyeWidth;
              
              // Map to the Python logic offsets
              let horiz: GazeResult["horizontal"] = "center";
              if (irisRelativeX < 0.35) horiz = "right";  // mirrored webcam
              else if (irisRelativeX > 0.65) horiz = "left";
              
              let vert: GazeResult["vertical"] = "center";
              // Vertical mapping using eyelids (approx)
              const topEyelid = landmarks[159];
              const bottomEyelid = landmarks[145];
              const eyeHeight = bottomEyelid.y - topEyelid.y;
              if (Math.abs(eyeHeight) > 0.001) {
                 const irisRelativeY = (leftIris.y - topEyelid.y) / eyeHeight;
                 if (irisRelativeY < 0.3) vert = "up";
                 else if (irisRelativeY > 0.7) vert = "down";
              }

              setGazeResult({ horizontal: horiz, vertical: vert });
            }

            // Draw Iris for visualization
            canvasCtx.fillStyle = "cyan";
            const w = canvasRef.current.width;
            const h = canvasRef.current.height;
            canvasCtx.beginPath();
            canvasCtx.arc(leftIris.x * w, leftIris.y * h, 3, 0, 2 * Math.PI);
            canvasCtx.fill();
            
            const rightIris = landmarks[473];
            canvasCtx.beginPath();
            canvasCtx.arc(rightIris.x * w, rightIris.y * h, 3, 0, 2 * Math.PI);
            canvasCtx.fill();
          } else {
            setStatus("No face detected");
          }
        });

        if (videoRef.current) {
          camera = new Camera(videoRef.current, {
            onFrame: async () => {
              if (!videoRef.current || !faceMesh) return;
              await faceMesh.send({ image: videoRef.current });
            },
            width: 320,
            height: 240
          }) as unknown as MediaPipeCamera;
          camera.start();
        }
      } catch (err) {
        console.error("Error initializing MediaPipe:", err);
        setStatus("Initialization Failed");
      }
    }

    if (typeof window !== "undefined") {
      initTracker();
    }

    return () => {
      if (camera) camera.stop();
      if (faceMesh) faceMesh.close();
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 bg-slate-900 border border-slate-700 p-4 rounded-xl shadow-2xl flex flex-col items-center z-50">
      <div className="flex justify-between w-full mb-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Anti-Cheat Monitor</span>
        <div className={`w-3 h-3 rounded-full ${status.includes("Active") ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
      </div>
      
      <div className="relative w-[160px] h-[120px] bg-black rounded overflow-hidden">
        <video 
          ref={videoRef} 
          className="absolute inset-0 w-full h-full object-cover mirror-x opacity-0 pointer-events-none" 
          playsInline 
        />
        <canvas 
          ref={canvasRef} 
          width={160} 
          height={120} 
          className="absolute inset-0 w-full h-full object-cover mirror-x scale-x-[-1]" 
        />
      </div>

      <div className="mt-3 text-sm text-center space-y-1">
        <p className="text-slate-300">{status}</p>
        {status.includes("Active") && (
          <p className="text-cyan-400 font-semibold">
            Gaze: {gazeResult.horizontal} / {gazeResult.vertical}
          </p>
        )}
        <p className="text-red-400 text-xs">Tab Switches: {tabSwitches}</p>
      </div>
    </div>
  );
}
