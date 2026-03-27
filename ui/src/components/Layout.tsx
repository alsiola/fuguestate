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
        <div className="p-4 border-t">
          <AgentEgo />
        </div>
        <div className="px-4 pb-3 text-[10px] text-muted-foreground/50">
          fuguestate v1.0
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
