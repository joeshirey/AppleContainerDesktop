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
import { checkSystemStatus, startSystem, stopSystem } from "./api";
import type { NavSection } from "./types";
import styles from "./App.module.css";

function ActiveView({ section }: { section: NavSection }) {
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
  const [sysRunning, setSysRunning] = useState(true);

  useEffect(() => {
    checkSystemStatus()
      .then(s => setSysRunning(!!s))
      .catch(() => setSysRunning(false));
  }, []);

  async function handleStart() {
    try { await startSystem(); setSysRunning(true); } catch (e) { console.error('startSystem failed:', e); }
  }

  async function handleStop() {
    try { await stopSystem(); setSysRunning(false); } catch (e) { console.error('stopSystem failed:', e); }
  }

  return (
    <div className={styles.app}>
      <Sidebar active={active} onSelect={setActive} />
      <div className={styles.body}>
        <SystemBanner running={sysRunning} onStart={handleStart} onStop={handleStop} />
        <main className={styles.main}><ActiveView section={active} /></main>
      </div>
    </div>
  );
}
