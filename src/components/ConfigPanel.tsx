import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sliders, RotateCcw, Award, Split, Play, FolderTree, Cpu, Repeat, Layers, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { AppState, AppAction } from '../types';
import { ALL_RULES_METADATA } from '../core/iroptimizer/1_domain/rules/RuleDefinitions';

interface Props {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  onCompile: () => void;
  isLoading: boolean;
}

interface HtmlOptionDef {
  key: 'htmlOptCss' | 'htmlOptJs' | 'htmlOptImg';
  label: string;
}

const HTML_OPTIONS: HtmlOptionDef[] = [
  { key: 'htmlOptCss', label: 'CSSファイルをスタイルに変換' },
  { key: 'htmlOptJs', label: 'JSを統合してインライン展開' },
  { key: 'htmlOptImg', label: '画像をBase64でインライン化' },
];

export function ConfigPanel({ state, dispatch, onCompile, isLoading }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const setAllRulesOfType = (type: 'micro' | 'macro', enabled: boolean) => {
    const newRules = { ...state.config.enabledRuleIds };
    ALL_RULES_METADATA.forEach(rule => {
      if (rule.type === type) {
        newRules[rule.id] = enabled;
      }
    });
    dispatch({ type: 'SET_CONFIG', key: 'enabledRuleIds', value: newRules });
  };
  
  // スライダーUIをレンダリングするヘルパー関数
  const renderSlider = (key: keyof AppState['config'], label: string, desc: string, min: number, max: number, colorClass: string) => {
    const val = state.config[key] as number;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-slate-300 text-xs font-medium">
          <div className="flex flex-col">
            <span>{label} <span className="font-mono text-[10px] opacity-50 ml-0.5">({key})</span></span>
            <span className="text-[9px] text-slate-500 font-normal">{desc}</span>
          </div>
          <span className={`font-bold font-mono ${colorClass} bg-black/20 px-1.5 py-0.5 rounded shadow-inner`}>{val}</span>
        </div>
        <input 
          className="nop-slider" 
          type="range" min={min} max={max} value={val} 
          onChange={e => dispatch({ type: 'SET_CONFIG', key, value: parseInt(e.target.value) })} 
        />
      </div>
    );
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="nop-panel p-5 flex flex-col gap-5 shrink-0"
      >
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-5 text-[#4da6ff] w-5" />
            <h2 className="font-bold text-sm text-slate-200">ビルド・ゴルフ設定</h2>
          </div>
          <button className="nop-btn text-[11px] px-2.5 py-1 gap-1 text-red-400 hover:text-red-300" onClick={() => dispatch({ type: 'RESET' })}>
            <RotateCcw className="h-3 w-3" />リセット
          </button>
        </div>

        <div className="segmented-switch">
          <button className={state.mode === 'html' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_MODE', mode: 'html' })}>🌐 HTML単一化</button>
          <button className={state.mode === 'smart' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_MODE', mode: 'smart' })}>📦 JSスマート結合</button>
          <button className={state.mode === 'direct' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_MODE', mode: 'direct' })}>直接入力</button>
        </div>

        {/* HTML単一化オプション */}
        {state.mode === 'html' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">エントリーHTML <span className="font-mono text-[10px] opacity-50 ml-1.5">(htmlEntry)</span></label>
              <select className="nop-select text-xs py-2 px-3 w-full font-mono" value={state.config.htmlEntry} onChange={e => dispatch({ type: 'SET_CONFIG', key: 'htmlEntry', value: e.target.value })}>
                {Array.from(state.files.keys()).filter(f => f.endsWith('.html')).map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
                {Array.from(state.files.keys()).filter(f => f.endsWith('.html')).length === 0 && <option value="">ファイルなし</option>}
              </select>
            </div>
            <div className="flex flex-col border border-white/5 bg-slate-950/20 rounded-xl gap-2.5 p-3 shadow-inner">
              {HTML_OPTIONS.map(({ key, label }) => (
                <label key={key} className="nop-checkbox-container text-slate-300">
                  <input type="checkbox" checked={state.config[key] as boolean} onChange={e => dispatch({ type: 'SET_CONFIG', key, value: e.target.checked })} />
                  <span className="checkmark"></span>{label} <span className="font-mono text-[10px] opacity-50 ml-1.5">({key})</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ASTコードゴルフオプション (処理の入れ子構造を表現したUI) */}
        <div className="flex flex-col border-t border-white/5 gap-3 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-amber-400 text-xs tracking-wider uppercase">
              <Award className="h-4 w-4" />ASTコードゴルフオプション <span className="font-mono text-[10px] opacity-70 normal-case ml-1">(golfEnabled)</span>
            </div>
            <label className="items-center cursor-pointer relative inline-flex">
              <input className="sr-only peer" type="checkbox" checked={state.config.golfEnabled} onChange={e => dispatch({ type: 'SET_CONFIG', key: 'golfEnabled', value: e.target.checked })} />
              <div className="rounded-full border border-white/5 after:absolute after:bg-slate-400 after:border after:border-slate-300 after:content-[''] after:h-4 after:left-[2px] after:rounded-full after:top-[2px] after:transition-all after:w-4 bg-[#1e2125] h-5 w-9 peer peer-checked:after:translate-x-full peer-checked:after:border-white peer-checked:bg-amber-600 shadow-inner"></div>
            </label>
          </div>

          {state.config.golfEnabled && (
            <div className="flex flex-col gap-3 mt-1 transition-all">
              {/* === 第一段階: 論理構造圧縮 (ASTコードゴルフ) === */}
              <div className="flex flex-col border border-amber-500/20 rounded-xl bg-amber-500/5 p-3.5 shadow-inner">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-500/90 mb-3 uppercase tracking-wider border-b border-amber-500/10 pb-1.5">
                  <Award className="w-3.5 h-3.5" />1. 論理構造圧縮 (ASTコードゴルフ)
                </div>

                {/* アコーディオン開閉ボタン */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full p-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-xs font-semibold text-amber-400 transition-all border border-amber-500/20"
                >
                  <span className="flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    高度な探索アルゴリズム設定
                  </span>
                  <span className="text-amber-500/70 font-mono text-[10px] flex items-center gap-1">
                    {showAdvanced ? (
                      <>閉じる <ChevronUp className="w-3.5 h-3.5" /></>
                    ) : (
                      <>詳細設定を開く <ChevronDown className="w-3.5 h-3.5" /></>
                    )}
                  </span>
                </button>

                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden flex flex-col gap-4 mt-3"
                    >
                      {/* 1.1 Orchestrator */}
                      <div className="flex flex-col gap-1.5 mt-1 border border-white/5 bg-slate-950/20 p-3 rounded-lg shadow-inner">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300 uppercase tracking-wider border-b border-white/5 pb-1.5">
                          <Repeat className="w-3 h-3 text-amber-500" />全体反復制御 (Orchestrator)
                        </div>
                        <div className="mt-1 flex flex-col gap-3">
                          {renderSlider('maxIterations', '最大イテレーション', '限界に達するまで全体を回す最大周回数', 1, 100, 'text-amber-400')}
                          {renderSlider('patience', '収束判定の許容停滞回数 (Patience)', '改善が見られないまま探索を継続する最大ステップ数', 1, 50, 'text-amber-400')}
                        </div>
                      </div>

                      {/* 1.2 Phase Scheduler (Orchestratorの周回ごとの処理) */}
                      <div className="flex flex-col border border-white/5 rounded-lg bg-slate-950/20 p-3 shadow-inner">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300 mb-3 uppercase tracking-wider border-b border-white/5 pb-1.5">
                          <Layers className="w-3.5 h-3.5 text-amber-500" />各周回のフェーズ進行 (Phase Scheduler)
                        </div>
                        <div className="flex flex-col gap-3">
                          {renderSlider('stage1Depth', 'STAGE 1: 粗削り', '広域探索の深さ (Depth)', 1, 100, 'text-amber-400')}
                          {renderSlider('stage2Depth', 'STAGE 2: 極限圧縮', '詳細探索の深さ (Depth)', 1, 300, 'text-amber-400')}
                        </div>

                        {/* 1.3 Search Engine (各フェーズで使われる探索手法) */}
                        <div className="flex flex-col border border-white/5 rounded-lg bg-slate-950/20 p-3 mt-4 shadow-inner">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300 mb-3 uppercase tracking-wider border-b border-white/5 pb-1.5">
                            <Cpu className="w-3.5 h-3.5 text-amber-500" />探索アルゴリズム (Search Engine)
                          </div>
                          
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between text-slate-300 text-xs">
                              <div className="flex flex-col">
                                <span className="font-medium text-slate-200">
                                  <Split className="h-3 w-3 inline mr-1 text-amber-500" />投機的並行探索 <span className="font-mono text-[10px] opacity-50 ml-0.5">(enableBeamSearch)</span>
                                </span>
                                <span className="text-[9px] text-slate-500 ml-4 font-normal">複数の世界線を展開して最適解を探す</span>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  className="sr-only peer" 
                                  checked={state.config.enableBeamSearch} 
                                  onChange={e => dispatch({ type: 'SET_CONFIG', key: 'enableBeamSearch', value: e.target.checked })} 
                                />
                                <div className="w-7 h-4 bg-[#1e2125] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-600 shadow-inner border border-white/5"></div>
                              </label>
                            </div>

                            {state.config.enableBeamSearch && (
                              <div className="mt-1 pl-2 border-l-2 border-amber-500/30">
                                {renderSlider('beamWidth', '基本ビーム幅', '同時に保持する並行世界の最大数', 1, 50, 'text-amber-400')}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 1.4 最適化ルールの個別制御 (Auto Discovered) */}
                        <div className="flex flex-col border border-white/5 rounded-lg bg-slate-950/20 p-3 shadow-inner mt-4 mb-1">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300 mb-3 uppercase tracking-wider border-b border-white/5 pb-1.5">
                            <Layers className="w-3.5 h-3.5 text-amber-500" />最適化ルールの個別制御 (Auto Discovered)
                          </div>

                          {/* 一括有効・無効制御ボタン */}
                          <div className="flex flex-wrap items-center gap-y-2 gap-x-4 mb-3 pb-3 border-b border-white/5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">ミクロ:</span>
                              <button
                                type="button"
                                onClick={() => setAllRulesOfType('micro', true)}
                                className="px-2 py-1 rounded text-[10px] bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 font-medium cursor-pointer transition-colors"
                              >
                                すべて有効
                              </button>
                              <button
                                type="button"
                                onClick={() => setAllRulesOfType('micro', false)}
                                className="px-2 py-1 rounded text-[10px] bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300 font-medium cursor-pointer transition-colors"
                              >
                                すべて無効
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">マクロ:</span>
                              <button
                                type="button"
                                onClick={() => setAllRulesOfType('macro', true)}
                                className="px-2 py-1 rounded text-[10px] bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 font-medium cursor-pointer transition-colors"
                              >
                                すべて有効
                              </button>
                              <button
                                type="button"
                                onClick={() => setAllRulesOfType('macro', false)}
                                className="px-2 py-1 rounded text-[10px] bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300 font-medium cursor-pointer transition-colors"
                              >
                                すべて無効
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-3">
                            {ALL_RULES_METADATA.map(rule => {
                              const isEnabled = state.config.enabledRuleIds[rule.id] ?? rule.defaultEnabled;

                              return (
                                <div key={rule.id} className="flex items-center justify-between text-slate-300 text-xs">
                                  <div className="flex flex-col max-w-[80%]">
                                    <span className="font-medium text-slate-200">
                                      {rule.name}
                                      <span className="font-mono text-[9px] opacity-50 ml-1.5 px-1 py-0.5 rounded bg-black/30 text-amber-400">
                                        {rule.type}
                                      </span>
                                    </span>
                                    <span className="text-[9px] text-slate-500 font-normal leading-tight mt-0.5">
                                      {rule.description}
                                    </span>
                                  </div>
                                  
                                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input 
                                      type="checkbox" 
                                      className="sr-only peer" 
                                      checked={isEnabled} 
                                      onChange={e => {
                                        const newRules = { ...state.config.enabledRuleIds, [rule.id]: e.target.checked };
                                        dispatch({ type: 'SET_CONFIG', key: 'enabledRuleIds', value: newRules });
                                      }} 
                                    />
                                    <div className="w-7 h-4 bg-[#1e2125] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-600 shadow-inner border border-white/5"></div>
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* === 第二段階: 物理表面圧縮 (Physical Compressor) === */}
              <div className="flex flex-col border border-white/5 rounded-xl bg-slate-950/20 p-3.5 shadow-inner">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-sky-400/90 mb-3 uppercase tracking-wider border-b border-white/5 pb-1.5">
                  <Sliders className="w-3.5 h-3.5" />2. 物理表面圧縮 (Physical Compressor)
                </div>
                
                <div className="flex flex-col gap-3 mt-1">
                  {/* 変数一文字化 */}
                  <div className="flex items-center justify-between text-slate-300 text-xs">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-200">
                        変数名の一文字化 (Terser) <span className="font-mono text-[10px] opacity-50 ml-0.5">(enableMangle)</span>
                      </span>
                      <span className="text-[9px] text-slate-500 font-normal">Terserによる変数名・関数名の一文字化(toplevel: true)を実行する</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={state.config.enableMangle} 
                        onChange={e => dispatch({ type: 'SET_CONFIG', key: 'enableMangle', value: e.target.checked })} 
                      />
                      <div className="w-7 h-4 bg-[#1e2125] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-sky-500 shadow-inner border border-white/5"></div>
                    </label>
                  </div>

                  {/* Terser構造圧縮 */}
                  <div className="flex items-center justify-between text-slate-300 text-xs border-t border-white/5 pt-2 mt-1">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-200">
                        Terserによる極限構造圧縮 <span className="font-mono text-[10px] opacity-50 ml-0.5">(terserCompress)</span>
                      </span>
                      <span className="text-[9px] text-slate-500 font-normal">本番用。OFFにすると自作IR最適化の純粋な効果のみを測定できます</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={state.config.terserCompress} 
                        onChange={e => dispatch({ type: 'SET_CONFIG', key: 'terserCompress', value: e.target.checked })} 
                      />
                      <div className="w-7 h-4 bg-[#1e2125] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-sky-500 shadow-inner border border-white/5"></div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* アセットフィルタ設定 */}
        <div className="flex flex-col border-t border-white/5 gap-3 pt-4">
          <div className="flex items-center gap-2 font-bold text-sky-400 text-xs tracking-wider uppercase">
            <FolderTree className="h-4 w-4" />アセットフィルタ設定
          </div>
          <div className="flex flex-col border border-white/5 bg-slate-950/20 rounded-xl gap-3 p-3.5 shadow-inner">
            <label className="nop-checkbox-container text-slate-300">
              <input 
                type="checkbox" 
                checked={!!state.config.includeNodeModules} 
                onChange={e => dispatch({ type: 'SET_CONFIG', key: 'includeNodeModules', value: e.target.checked })} 
              />
              <span className="checkmark"></span>
              node_modules を含む <span className="font-mono text-[10px] opacity-50 ml-1">(includeNodeModules)</span>
            </label>

            <div className="flex flex-col gap-1.5 mt-1">
              <label className="text-[11px] text-slate-400 font-medium block">
                除外パターン (カンマ区切り) <span className="font-mono text-[10px] opacity-50 ml-1">(excludePatterns)</span>
              </label>
              <input 
                type="text" 
                className="nop-input text-xs font-mono w-full px-3 py-2 bg-slate-950/40 border border-white/10 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
                placeholder="例: node_modules, \\.config\\., \\.d\\.ts"
                value={state.config.excludePatternsStr || ''} 
                onChange={e => dispatch({ type: 'SET_CONFIG', key: 'excludePatternsStr', value: e.target.value })} 
              />
            </div>
          </div>
        </div>

        <button
          className="nop-btn w-full py-3 text-white bg-gradient-to-r from-[#0284c7] to-[#0ea5e9] font-bold tracking-wider rounded-xl shadow-lg shadow-black/20"
          onClick={onCompile}
          disabled={isLoading}
        >
          <Play className="h-4 w-4 mr-1.5 inline" /> SoCゴルフコンパイルを実行
        </button>
      </motion.div>
      
      {state.files.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="nop-panel p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2 border-b border-white/5 pb-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
            <FolderTree className="h-4 w-4" /> ロード済みファイル ({state.files.size})
          </div>
          <div className="max-h-48 overflow-y-auto pr-2 custom-scrollbar">
            {Array.from(state.files.keys()).map(f => (
              <div key={f} className="text-[11px] text-slate-300 py-1.5 border-b border-white/5 truncate font-mono flex items-center justify-between group">
                <span className="truncate pr-2">{f}</span>
                <span className="text-slate-500 text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">{(state.files.get(f)?.length || 0).toLocaleString()} B</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </>
  );
}