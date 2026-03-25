import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "RIGS" },
  { to: "/import", label: "IMPORT" },
] as const;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <nav
      data-testid="sidebar"
      className={cn(
        "w-[200px] bg-surface-dark bg-noise-dark flex flex-col shrink-0 z-20",
        "text-foreground-on-dark",
        // Mobile: slide-in overlay
        "fixed top-12 bottom-0 left-0 transition-transform duration-200 ease-tactical lg:relative lg:top-0 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex flex-col pt-spacing-6 flex-1">
        <div className="px-spacing-4 mb-spacing-4">
          <span className="text-label-sm uppercase tracking-[0.08em] text-foreground-muted-on-dark">
            NAVIGATION
          </span>
        </div>

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
                "px-spacing-4 py-spacing-3 text-label-lg uppercase tracking-[0.03em] transition-colors duration-150 ease-tactical relative",
                isActive
                  ? "text-foreground-on-dark bg-white/8"
                  : "text-foreground-muted-on-dark hover:text-foreground-on-dark hover:bg-white/4"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-foreground-on-dark" />
              )}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
