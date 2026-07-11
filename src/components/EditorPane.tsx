
import React from 'react';
import { motion } from 'motion/react';
import { Copy, Download, History, Pencil, Terminal } from 'lucide-react';
import { CompileLog } from '../pipeline/CompilerPipelineFacade';
import { AppState, AppAction } from '../types';
import Editor from '@monaco-editor/react';

interface Props {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  logs: CompileLog[];
  isLoading: boolean;
  onCopy: () => void;
  onDownload: () => void;
}

export function EditorPane({ state, dispatch, logs, isLoading, onCopy, onDownload }: Props) {
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
    }
  }, [logs]);

  const handleEditorChange = (value: string | undefined) => {
    if (state.editorTab === 'input') {
      dispatch({ type: 'SET_INPUT', code: value || '' });
    }
  };

  // 主要なエントリーファイルを自動判別する
  const getEntryFile = () => {
    if (state.mode === 'html') {
      return state.config.htmlEntry || 'index.html';
    } else if (state.mode === 'smart') {
      const fileKeys = Array.from(state.files.keys());
      const likelyEntry = fileKeys.find(f => f.endsWith('main.tsx') || f.endsWith('index.tsx') || f.endsWith('main.ts') || f.endsWith('index.ts') || f.endsWith('App.tsx') || f.endsWith('App.ts'));
      return likelyEntry || fileKeys.find(f => f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.jsx') || f.endsWith('.js')) || 'bundled.js';
    }
    return 'input.js';
  };

  const entryFile = getEntryFile();

  const getCurrentFile = () => {
    if (state.editorTab === 'input') {
      if (state.mode === 'direct') {
        return state.config.directLang === 'html' ? 'input.html' : (state.config.directLang === 'css' ? 'input.css' : 'input.js');
      }
      return entryFile;
    }
    return state.mode === 'html' ? 'index.min.html' : 'bundled.js';
  };

  const currentFile = getCurrentFile();

  const getLanguage = () => {
    if (currentFile.endsWith('.html')) return 'html';
    if (currentFile.endsWith('.css')) return 'css';
    if (currentFile.endsWith('.ts') || currentFile.endsWith('.tsx')) return 'typescript';
    return 'javascript';
  };

  let currentCode = state.outputCode;
  if (state.editorTab === 'input') {
    if (state.mode === 'direct') {
      currentCode = state.inputCode;
    } else {
      currentCode = state.files.get(entryFile) || '';
    }
  }

  const handleEditorWillMount = (monaco: any) => {
    monaco.editor.defineTheme('nop-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e2125',
      },
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="nop-panel p-5 flex flex-col flex-1 overflow-hidden relative"
    >
      <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-slate-600 h-3 w-3 shadow-inner"></div>
          <span className="text-xs font-mono ml-2 text-slate-400">
            {currentFile}
          </span>
        </div>
        <div className="flex gap-2">
          <button className="nop-btn text-xs font-semibold gap-1.5 px-3 py-1.5" onClick={onCopy} disabled={!state.outputCode}>
            <Copy className="h-3.5 w-3.5" />コピー
          </button>
          <button className="nop-btn text-xs font-semibold rounded-lg bg-[#0284c7] text-white border border-white/10 px-3 py-1.5 shadow-md hover:bg-[#0ea5e9] disabled:opacity-30" onClick={onDownload} disabled={!state.outputCode}>
            <Download className="h-3.5 w-3.5 mr-1 inline" />保存
          </button>
        </div>
      </div>
      
      {logs.length > 0 && (
        <div className="flex flex-col border border-white/5 rounded-xl bg-slate-950/50 backdrop-blur-md overflow-hidden font-mono h-[140px] shrink-0 mb-3 p-4 text-xs shadow-inner">
          <div className="flex items-center justify-between border-b border-white/5 mb-2 pb-2 text-slate-400">
            <span className="flex items-center gap-1.5 font-bold text-amber-400"><History className="h-3.5 w-3.5" />ビルド・最適化ログ</span>
          </div>
          <div ref={logsEndRef} className="space-y-1 flex-1 overflow-y-auto custom-scrollbar">
            {logs.map((l, i) => (
              <div key={i} className={l.type === 'error' ? 'text-red-400 whitespace-pre-wrap' : l.type === 'success' ? 'text-emerald-400' : 'text-slate-300 whitespace-pre-wrap'}>{l.msg}</div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative">
        <div className="segmented-switch mb-3 shrink-0">
          <button className={state.editorTab === 'input' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_EDITOR_TAB', tab: 'input' })}><Pencil className="h-3.5 w-3.5 inline mr-1" />入力 (Input)</button>
          <button className={state.editorTab === 'output' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_EDITOR_TAB', tab: 'output' })}><Terminal className="h-3.5 w-3.5 inline mr-1" />出力 (Output)</button>
        </div>
        <div className="nop-panel-inset flex flex-1 min-h-0 relative overflow-hidden rounded-xl">
          {/* 「直接入力」モードではない、かつファイルが0個の時だけ案内画面を出す */}
          {state.editorTab === 'input' && state.mode !== 'direct' && state.files.size === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 w-full h-full text-center bg-slate-950/10">
              <Pencil className="h-12 w-12 text-[#4da6ff]/40 mb-3" />
              <h3 className="font-bold text-sm text-slate-200 mb-1">プロジェクトが読み込まれていません</h3>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                プロジェクトフォルダを左側のエリアにドラッグ＆ドロップするか、<br />
                上部の「直接入力」モードに切り替えてコードを記述してください。
              </p>
            </div>
          ) : state.editorTab === 'output' && !state.outputCode ? (
            <div className="flex flex-col items-center justify-center p-6 w-full h-full text-center bg-slate-950/10">
              <Terminal className="h-12 w-12 text-slate-600 mb-3" />
              <h3 className="font-bold text-sm text-slate-300 mb-1">コンパイル出力がありません</h3>
              <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
                ソースコードを入力するかプロジェクトを読み込み、<br />
                左下の<strong>「SoCゴルフコンパイルを実行」</strong>ボタンを押してください。
              </p>
            </div>
          ) : (
            <>
              <Editor
                height="100%"
                width="100%"
                language={getLanguage()}
                theme="nop-theme"
                value={currentCode}
                onChange={handleEditorChange}
                beforeMount={handleEditorWillMount}
                options={{
                  readOnly: state.editorTab === 'output' || (state.editorTab === 'input' && state.mode !== 'direct'),
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                  lineHeight: 1.5,
                  padding: { top: 12, bottom: 12 },
                  automaticLayout: true,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  fontLigatures: true,
                  renderLineHighlight: 'all',
                  scrollbar: {
                    vertical: 'auto',
                    horizontal: 'auto',
                    useShadows: false,
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  }
                }}
                loading={
                  <div className="flex items-center flex-col absolute bg-slate-950/80 gap-3 inset-0 justify-center z-20">
                    <div className="rounded-full animate-spin border-4 border-[#0ea5e9] border-t-transparent h-10 w-10"></div>
                    <p className="text-sm font-semibold text-slate-300">エディタを起動中...</p>
                  </div>
                }
              />
              {isLoading && (
                <div className="flex items-center flex-col absolute backdrop-blur-sm bg-slate-950/80 gap-3 inset-0 justify-center z-20">
                  <div className="rounded-full animate-spin border-4 border-[#0ea5e9] border-t-transparent h-10 w-10"></div>
                  <p className="text-sm font-semibold text-slate-300">モジュールを解析中...</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
