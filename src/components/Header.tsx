import React from 'react';
import { Cpu } from 'lucide-react';

export function Header() {
  return (
    <header className="border-white/5 backdrop-blur-xl bg-[#2b2f35]/60 border-b sticky top-0 z-50 shadow-md">
      <div className="flex items-center justify-between flex-col gap-4 sm:flex-row max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="nop-panel-inset p-2 text-[#4da6ff] flex items-center justify-center rounded-xl">
            <Cpu className="h-7 w-7" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 font-bold text-white text-xl tracking-tight">
              JS Folder Bundler<span className="text-xs px-2 py-0.5 rounded-full font-mono font-normal text-amber-400 nop-panel-inset">Strict SoC Modular ⛳️</span>
            </h1>
            <p className="text-xs text-slate-400"></p>
          </div>
        </div>
      </div>
    </header>
  );
}
