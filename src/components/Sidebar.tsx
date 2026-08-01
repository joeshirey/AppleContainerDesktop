import type { NavSection } from "../types";
import styles from "./Sidebar.module.css";

const ITEMS: { key: NavSection; label: string }[] = [
  { key: "containers", label: "Containers" },
  { key: "images",     label: "Images" },
  { key: "builder",   label: "Builder" },
  { key: "hub",        label: "Hub Search" },
  { key: "machines",   label: "Machines" },
  { key: "volumes",    label: "Volumes" },
  { key: "networks",   label: "Networks" },
];

export function Sidebar({ active, onSelect }: { active: NavSection; onSelect: (s: NavSection) => void }) {
  return (
    <nav className={styles.sidebar}>
      <div className={styles.section}>
        <span className={styles.label}>Manage</span>
        {ITEMS.map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.item} ${active === key ? styles.active : ""}`}
            data-active={active === key ? true : undefined}
            onClick={() => onSelect(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.bottom}>
        <button
          className={`${styles.item} ${active === "settings" ? styles.active : ""}`}
          data-active={active === "settings" ? true : undefined}
          onClick={() => onSelect("settings")}
        >
          Settings
        </button>
      </div>
    </nav>
  );
}
