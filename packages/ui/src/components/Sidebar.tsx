import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "RIGS", icon: "hub" },
  { to: "/packages", label: "SPECS", icon: "folder" },
  { to: "/bootstrap", label: "BOOT", icon: "play_arrow" },
  { to: "/discovery", label: "DISC", icon: "radar" },
  { to: "/import", label: "IMPORT", icon: "upload" },
] as const;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        "w-20 bg-stone-100/80 backdrop-blur-md border-r border-stone-300 flex flex-col items-center py-spacing-6 shrink-0 z-20",
        // Mobile: slide-in overlay
        "fixed top-14 bottom-0 left-0 transition-transform duration-200 ease-tactical lg:relative lg:top-0 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Brand mark */}
      <div className="mb-spacing-6 text-center">
        <div className="text-stone-900 font-bold font-mono text-[10px] tracking-widest uppercase">
          TOPOLOGY
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col w-full gap-spacing-1 flex-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.to === "/"
            ? currentPath === "/" || currentPath.startsWith("/rigs")
            : currentPath.startsWith(item.to);

          return (
            <Link
              key={item.to}
              to={item.to}
              data-testid={`nav-${item.label.toLowerCase()}`}
              aria-current={isActive ? "page" : undefined}
              onClick={onClose}
              className={cn(
                "flex flex-col items-center py-spacing-3 gap-1 transition-all duration-75",
                isActive
                  ? "bg-background text-stone-950 border-y border-l-4 border-l-stone-900"
                  : "text-stone-400 hover:text-stone-900"
              )}
            >
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 0, 'wght' 300" }}>
                {item.icon}
              </span>
              <span className="font-mono text-[8px] tracking-widest">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
