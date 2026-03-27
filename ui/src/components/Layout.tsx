import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AgentEgo } from "./AgentEgo";

const navItems = [
  { to: "", label: "Dashboard", icon: "🧠" },
  { to: "dreams", label: "Dreams", icon: "🌙" },
  { to: "spirit-quests", label: "Spirit Quests", icon: "🍄" },
  { to: "beliefs", label: "Beliefs", icon: "💎" },
  { to: "episodes", label: "Episodes", icon: "📖" },
  { to: "open-loops", label: "Open Loops", icon: "🔄" },
];

export function Layout() {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card/50 flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-primary">FugueState</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Agentic memory through dreams</p>
        </div>
        <div className="p-4 border-b">
          <AgentEgo />
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === ""}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 pb-3 flex items-center justify-between text-[10px] text-muted-foreground/50">
          <span>fuguestate v1.0</span>
          <a
            href="https://github.com/alsiola/fuguestate"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
