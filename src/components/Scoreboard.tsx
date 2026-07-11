
import React from 'react';
import { motion } from 'motion/react';
import { Award } from 'lucide-react';

interface Props {
  stats: { originalSize: number; finalSize: number } | null;
}

export function Scoreboard({ stats }: Props) {
  if (!stats) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0, scale: 0.95 }}
      animate={{ opacity: 1, height: 'auto', scale: 1 }}
      exit={{ opacity: 0, height: 0, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      className="nop-panel flex items-center justify-between flex-col gap-4 sm:flex-row p-4 bg-amber-500/5 border-amber-500/15 origin-top overflow-hidden"
    >
      <div className="flex items-center gap-3">
        <div className="p-3 border rounded-xl bg-amber-500/10 border-amber-500/20 text-amber-400 shadow-inner">
          <Award className="animate-bounce h-6 w-6" />
        </div>
        <div>
          <div className="text-xs text-slate-400 font-bold">⛳️ GOLF SCOREBOARD</div>
          <div className="flex items-center gap-2 font-extrabold text-amber-400 text-lg">
            極限の削減に成功！
            <span className="text-xs font-mono px-2 py-0.5 bg-red-600/80 border border-white/5 font-bold rounded text-white">RANK SSS</span>
          </div>
        </div>
      </div>
      <div className="flex font-mono gap-4 sm:gap-6 bg-slate-950/40 border border-white/5 p-2 rounded-xl shadow-inner">
        <div className="text-center">
          <div className="text-slate-500 text-[10px]">元容量</div>
          <div className="font-bold text-sm text-slate-400">{(stats.originalSize / 1024).toFixed(2)} KB</div>
        </div>
        <div className="flex items-center text-slate-600">➔</div>
        <div className="text-center">
          <div className="text-slate-500 text-[10px]">最適化後</div>
          <div className="font-bold text-sm text-emerald-400">{(stats.finalSize / 1024).toFixed(2)} KB</div>
        </div>
        <div className="border-white/10 text-center border-l pl-4 sm:pl-6">
          <div className="text-slate-500 text-[10px]">極限削減率</div>
          <div className="text-base font-extrabold text-amber-500">-{(100 - (stats.finalSize / Math.max(1, stats.originalSize)) * 100).toFixed(1)}%</div>
        </div>
      </div>
    </motion.div>
  );
}
