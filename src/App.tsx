import { useState, useEffect } from "react";
import { Sidebar }       from "./components/Sidebar";
import { SystemBanner }  from "./components/SystemBanner";
import { ContainersView } from "./views/ContainersView";
import { ImagesView }    from "./views/ImagesView";
import { HubSearchView } from "./views/HubSearchView";
import { MachinesView }  from "./views/MachinesView";
import { SettingsView }  from "./views/SettingsView";
import { checkSystemStatus, startSystem } from "./api";
import type { NavSection } from "./types";
import styles from "./App.module.css";

function ActiveView({ section }: { section: NavSection }) {
  switch (section) {
    case "containers": return <ContainersView />;
    case "images":     return <ImagesView />;
    case "hub":        return <HubSearchView />;
    case "machines":   return <MachinesView />;
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
    try { await startSystem(); setSysRunning(true); } catch {}
  }

  return (
    <div className={styles.app}>
      <Sidebar active={active} onSelect={setActive} />
      <div className={styles.body}>
        <SystemBanner running={sysRunning} onStart={handleStart} />
        <main className={styles.main}><ActiveView section={active} /></main>
      </div>
    </div>
  );
}
