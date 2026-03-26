import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { User, Video, Mic, Settings, Layers, BrainCircuit, Menu, X, Plus } from "lucide-react";
import { useState } from "react";
import { useSettingsStore } from "@/lib/store";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const isConfigured = useSettingsStore(state => state.isConfigured());

  const navItems = [
    { name: "Dashboard", href: "/", icon: Layers },
    { name: "Capture Studio", href: "/capture", icon: Mic },
    { name: "Script Studio", href: "/create-video", icon: Video },
    { name: "Video Library", href: "/videos", icon: BrainCircuit },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30 text-foreground">
      {/* Mobile Sidebar Overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 glass-panel-heavy transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 flex flex-col",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between p-6">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg group-hover:shadow-primary/50 transition-all">
              <User className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-white">Avatar<span className="text-primary">AI</span></span>
          </Link>
          <button className="lg:hidden text-muted-foreground hover:text-white" onClick={() => setIsMobileOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-2">
          {!isConfigured && (
            <Link href="/settings" className="block mb-6 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive-foreground hover:bg-destructive/20 transition-colors">
              <div className="text-xs font-semibold uppercase tracking-wider mb-1">Action Required</div>
              <div className="text-sm opacity-90">Please configure your API keys to start creating.</div>
            </Link>
          )}

          <Link href="/capture" className="flex items-center justify-center gap-2 w-full py-3 mb-6 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-semibold shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 transition-all duration-300">
            <Plus className="w-4 h-4" /> New Avatar
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive 
                    ? "bg-white/10 text-white shadow-sm border border-white/5" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-white"
                )}
                onClick={() => setIsMobileOpen(false)}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "text-primary" : "opacity-70")} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-white/5">
          <Link 
            href="/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200",
              location === "/settings" 
                ? "bg-white/10 text-white" 
                : "text-muted-foreground hover:bg-white/5 hover:text-white"
            )}
            onClick={() => setIsMobileOpen(false)}
          >
            <Settings className="w-5 h-5 opacity-70" />
            Settings
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-16 flex items-center justify-between px-6 lg:hidden border-b border-white/5 glass-panel-heavy absolute top-0 left-0 right-0 z-30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <User className="w-3 h-3 text-white" />
            </div>
            <span className="font-display font-bold text-lg text-white">AvatarAI</span>
          </div>
          <button onClick={() => setIsMobileOpen(true)} className="text-white">
            <Menu className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto pt-16 lg:pt-0 pb-10">
          <div className="max-w-6xl mx-auto p-6 md:p-8 lg:p-10">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
