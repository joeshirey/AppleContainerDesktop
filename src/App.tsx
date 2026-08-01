import { useState, useEffect } from "react";
import { Sidebar }       from "./components/Sidebar";
import { SystemBanner }  from "./components/SystemBanner";
import { ContainersView } from "./views/ContainersView";
import { ImagesView }    from "./views/ImagesView";
import { BuilderView }   from "./views/BuilderView";
import { HubSearchView } from "./views/HubSearchView";
import { MachinesView }  from "./views/MachinesView";
import { VolumesView }   from "./views/VolumesView";
import { NetworksView }  from "./views/NetworksView";
import { SettingsView }  from "./views/SettingsView";
import { BuildProvider } from "./hooks/useBuild";
import { checkSystemStatus, startSystem, stopSystem } from "./api";
import type { NavSection } from "./types";
import styles from "./App.module.css";

function ActiveView({ section }: { section: NavSection }): React.ReactElement {
  switch (section) {
    case "containers": return <ContainersView />;
    case "images":     return <ImagesView />;
    case "builder":    return <BuilderView />;
    case "hub":        return <HubSearchView />;
    case "machines":   return <MachinesView />;
    case "volumes":    return <VolumesView />;
    case "networks":   return <NetworksView />;
    case "settings":   return <SettingsView />;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function App() {
  const [active, setActive] = useState<NavSection>("containers");
  // null until the first status check answers — anything else means showing a
  // state we have not actually confirmed yet.
  const [sysRunning, setSysRunning] = useState<boolean | null>(null);
  const [sysError, setSysError] = useState<string | null>(null);

  useEffect(() => {
    checkSystemStatus()
      // The call succeeds on a stopped system too, returning a payload that
      // says so — so the status field is what decides, not the fact it resolved.
      .then(s => setSysRunning(s?.status?.toLowerCase() === "running"))
      .catch(() => setSysRunning(false));
  }, []);

  async function handleStart() {
    setSysError(null);
    try {
      await startSystem();
      setSysRunning(true);
    } catch (e) {
      setSysError(`Could not start the container system: ${message(e)}`);
    }
  }

  async function handleStop() {
    setSysError(null);
    try {
      await stopSystem();
      setSysRunning(false);
    } catch (e) {
      setSysError(`Could not stop the container system: ${message(e)}`);
    }
  }

  return (
    <BuildProvider>
      <div className={styles.app}>
        <Sidebar active={active} onSelect={setActive} />
        <div className={styles.body}>
          <SystemBanner
            running={sysRunning}
            error={sysError}
            onStart={handleStart}
            onStop={handleStop}
          />
          <main className={styles.main}><ActiveView section={active} /></main>
        </div>
      </div>
    </BuildProvider>
  );
}
