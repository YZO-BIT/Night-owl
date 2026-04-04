"use client";

import { useEffect, useMemo, useState } from "react";

type ThemeMode = "default" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "ui.theme.mode";

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const resolved = resolveTheme(mode);

  root.dataset.theme = resolved;
  root.classList.toggle("dark", resolved === "dark");
}

export default function ThemeSwitcher() {
  const [mode, setMode] = useState<ThemeMode>("default");

  const options = useMemo(
    () => [
      { value: "default", label: "Default" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ] as const,
    [],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: ThemeMode = stored === "light" || stored === "dark" || stored === "default" ? stored : "default";
    setMode(initial);
    applyTheme(initial);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (mode === "default") applyTheme("default");
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const onModeChange = (nextMode: ThemeMode) => {
    setMode(nextMode);
    window.localStorage.setItem(STORAGE_KEY, nextMode);
    applyTheme(nextMode);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[70]">
      <label className="glass-panel theme-control flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium shadow-lg">
        Theme
        <select
          aria-label="Theme mode"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as ThemeMode)}
          className="theme-select rounded-md px-2 py-1 text-xs outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
