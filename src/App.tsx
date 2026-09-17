import { useState, useEffect } from "react";
import { Sidebar }       from "./components/Sidebar";
import { SystemBanner }  from "./components/SystemBanner";
import { ContainersView } from "./views/ContainersView";
import { ImagesView }    from "./views/ImagesView";
import { HubSearchView } from "./views/HubSearchView";
import { MachinesView }  from "./views/MachinesView";
import { VolumesView }   from "./views/VolumesView";
import { NetworksView }  from "./views/NetworksView";
import { SettingsView }  from "./views/SettingsView";
import { BuildProvider } from "./hooks/useBuild";
import { message }       from "./lib/errors";
import { checkSystemStatus, startSystem, stopSystem } from "./api";
import type { NavSection } from "./types";
import styles from "./App.module.css";

function ActiveView({ section }: { section: NavSection }): React.ReactElement {
  switch (section) {
    case "containers": return <ContainersView />;
    case "images":     return <ImagesView />;
    case "hub":        return <HubSearchView />;
    case "machines":   return <MachinesView />;
    case "volumes":    return <VolumesView />;
    case "networks":   return <NetworksView />;
    case "settings":   return <SettingsView />;
  }
}

export default function App() {
  const [active, setActive] = useState<NavSection>("containers");
  // null until the first status check answers — anything else means showing a
  // state we have not actually confirmed yet.
  const [sysRunning, setSysRunning] = useState<boolean | null>(null);
  const [sysError, setSysError] = useState<string | null>(null);

  async function refreshSystemStatus() {
    setSysRunning(null);
    setSysError(null);
    try {
      const status = await checkSystemStatus();
      setSysRunning(status.status === "running");
    } catch (e) {
      setSysError(`Could not check the container system: ${message(e)}`);
    }
  }

  useEffect(() => { void refreshSystemStatus(); }, []);

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
            onRetry={refreshSystemStatus}
          />
          <main className={styles.main}><ActiveView section={active} /></main>
        </div>
      </div>
    </BuildProvider>
  );
}
