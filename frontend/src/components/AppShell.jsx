import { NavLink, useLocation } from "react-router-dom";
import { Aperture, ClockCounterClockwise, Cpu, GearSix, Keyboard, SidebarSimple } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const links = [
  { to: "/capture", label: "Capture", icon: Aperture },
  { to: "/history", label: "History", icon: ClockCounterClockwise },
  { to: "/platforms", label: "Platforms", icon: Cpu },
  { to: "/settings", label: "Settings", icon: GearSix },
];

export const AppShell = ({ children }) => {
  const location = useLocation();
  const active = links.find((link) => location.pathname.startsWith(link.to)) || links[0];
  return (
    <TooltipProvider delayDuration={250}>
      <div className="app-shell" data-testid="application-shell">
        <aside className="sidebar" data-testid="primary-navigation">
          <div className="brand-mark" data-testid="brand-mark"><SidebarSimple weight="bold" /></div>
          <nav>
            {links.map(({ to, label, icon: Icon }) => (
              <Tooltip key={to}>
                <TooltipTrigger asChild>
                  <NavLink to={to} data-testid={`nav-${label.toLowerCase()}-link`} className={({ isActive }) => `nav-icon ${isActive ? "active" : ""}`}>
                    <Icon weight="duotone" /><span>{label}</span>
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ))}
          </nav>
          <div className="shortcut-chip" data-testid="global-shortcut-indicator"><Keyboard /> Alt Shift S</div>
        </aside>
        <main className="main-stage">
          <header className="topbar">
            <div><span className="eyebrow" data-testid="current-section-label">Spatial / {active.label}</span><h1 data-testid="current-section-title">{active.label === "Capture" ? "Point. Ask. Act." : active.label}</h1></div>
            <div className="system-status" data-testid="system-status"><span /> AI layer ready</div>
          </header>
          {children}
        </main>
      </div>
    </TooltipProvider>
  );
};