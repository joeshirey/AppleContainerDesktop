import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ContainersView } from "./views/ContainersView";
import { ImagesView }    from "./views/ImagesView";
import { HubSearchView } from "./views/HubSearchView";
import { MachinesView }  from "./views/MachinesView";
import { SettingsView }  from "./views/SettingsView";
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
  return (
    <div className={styles.app}>
      <Sidebar active={active} onSelect={setActive} />
      <main className={styles.main}><ActiveView section={active} /></main>
    </div>
  );
}
