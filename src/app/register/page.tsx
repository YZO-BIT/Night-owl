"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="glass-panel w-full max-w-md rounded-3xl p-8">
        <h1 className="text-3xl font-extrabold mb-6">Register</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Password (min 8 chars)"
            className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            disabled={loading}
            className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 text-white font-bold py-4 rounded-2xl disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>
        <button
          onClick={() => router.push("/login")}
          className="mt-6 text-slate-300 hover:text-white text-sm"
        >
          Already have an account? Login
        </button>
      </div>
    </div>
  );
}
