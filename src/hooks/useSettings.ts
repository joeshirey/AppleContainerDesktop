import { useState, useEffect, useCallback } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

const store = new LazyStore(".settings.json");

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    store.get<Settings>("settings").then(saved => {
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...saved });
    });
  }, []);

  const updateSettings = useCallback(async (partial: Partial<Settings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    await store.set("settings", next);
    await store.save();
  }, [settings]);

  return { settings, updateSettings };
}
