
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { XCircle, Award, Copy } from 'lucide-react';
import { CompilerPipelineFacade, CompileLog } from './pipeline/CompilerPipelineFacade';
import { AppState, AppAction } from './types';
import { Header } from './components/Header';
import { DropZone } from './components/DropZone';
import { ConfigPanel } from './components/ConfigPanel';
import { Scoreboard } from './components/Scoreboard';
import { EditorPane } from './components/EditorPane';
import { AssetFilter } from './core/utils/AssetFilter';
import { ALL_RULES_METADATA } from './core/iroptimizer/1_domain/rules/RuleDefinitions';

const compiler = new CompilerPipelineFacade();

const initialEnabledRules: Record<string, boolean> = {};
ALL_RULES_METADATA.forEach(rule => {
  initialEnabledRules[rule.id] = rule.defaultEnabled;
});

const initialState: AppState = {
  files: new Map(),
  mode: 'html',
  config: {
    htmlOptCss: true, 
    htmlOptJs: true,  
    htmlOptImg: true, 
    golfEnabled: true,
    enableMangle: false,
    terserCompress: false,
    stage1Depth: 3,
    stage2Depth: 10,
    patience: 3,
    enableBeamSearch: false,
    beamWidth: 3,
    maxIterations: 5,
    enabledRuleIds: initialEnabledRules,
    addStrict: true,
    directLang: 'js',
    htmlEntry: '',
    includeNodeModules: false,
    excludePatternsStr: '',
    cdnTemplate: 'https://esm.sh/[module]@[version]/[path]',
  },
  editorTab: 'input',
  inputCode: '',
  outputCode: '',
};

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_FILES':
      return { ...state, files: action.files };
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'SET_CONFIG':
      return { ...state, config: { ...state.config, [action.key]: action.value } };
    case 'SET_EDITOR_TAB':
      return { ...state, editorTab: action.tab };
    case 'SET_INPUT':
      return { ...state, inputCode: action.code };
    case 'SET_OUTPUT':
      return { ...state, outputCode: action.code };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<CompileLog[]>([]);
  const [stats, setStats] = useState<{ originalSize: number; finalSize: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; icon: React.ReactNode } | null>(null);
  const toastTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const showToast = (message: string, icon: React.ReactNode) => {
    setToast({ message, icon });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  };

    const loadFiles = async (fileList: any) => {
    try {
      const newMap = new Map<string, string>(state.files);
      
      // FileReaderのPromiseを配列に集めて並行処理する
      const readPromises: Promise<{ path: string; content: string }>[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const item = fileList[i];
        let file: File;
        let path: string;
        
        if (item.file && item.path) {
          file = item.file;
          path = item.path;
        } else {
          file = item;
          path = item.webkitRelativePath || item.name;
        }

        if (!file) continue;

        // 隠しファイル（.DS_Storeなど）は除外する
        if (path.split('/').some(p => p.startsWith('.'))) continue;

        const readPromise = new Promise<{ path: string; content: string }>((resolve, reject) => {
          const reader = new FileReader();
          if (file.type && file.type.startsWith('image/')) {
            reader.onload = e => resolve({ path, content: e.target?.result as string });
            reader.readAsDataURL(file);
          } else {
            reader.onload = e => resolve({ path, content: e.target?.result as string });
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
          }
        });
        
        readPromises.push(readPromise);
      }

      // すべてのファイルを並行して読み込む (劇的に高速化)
      const results = await Promise.all(readPromises);

      // 読み込み結果をMapに格納
      for (const res of results) {
          const cleanPath = res.path.startsWith('/') ? res.path.slice(1) : res.path;
          newMap.set(cleanPath, res.content);
      }

      dispatch({ type: 'SET_FILES', files: newMap });
          
      const filterOpts = {
        includeNodeModules: state.config.includeNodeModules,
        excludePatterns: state.config.excludePatternsStr
          ? state.config.excludePatternsStr.split(',').map(p => p.trim()).filter(Boolean)
          : undefined
      };
      const htmls = Array.from(newMap.keys()).filter((f: string) => AssetFilter.isTargetHTML(f, newMap, filterOpts));
      const jss = Array.from(newMap.keys()).filter((f: string) => AssetFilter.isTargetJS(f, newMap, filterOpts));
      if (!state.config.htmlEntry && htmls.length > 0) dispatch({ type: 'SET_CONFIG', key: 'htmlEntry', value: htmls[0] });
      
      if (htmls.length > 0) {
        dispatch({ type: 'SET_MODE', mode: 'html' });
      } else if (jss.length > 0) {
        dispatch({ type: 'SET_MODE', mode: 'smart' });
      }
    } catch (err) {
      console.error(err);
      showToast('ファイルの読み込みに失敗しました', <XCircle className="w-4 h-4 text-[#ff5c5c]" />);
    }
  };

  const runCompile = async () => {
    setIsLoading(true);
    setLogs([]);
    setStats(null);
    let terserFailed = false;
    try {
      const result = await compiler.compile(state, (log) => {
        if (log.type === 'error' && (log.msg.includes('Failed to load Terser') || log.msg.includes('Terser execution threw exception'))) {
          terserFailed = true;
        }
        setLogs(prev => [...prev, log]);
      });
      dispatch({ type: 'SET_OUTPUT', code: result.code });
      dispatch({ type: 'SET_EDITOR_TAB', tab: 'output' });
      if (result.stats) setStats(result.stats);
      if (terserFailed) {
        showToast('最適化完了（※Terser読込エラーのため、変数難読化はスキップされました）', <Award className="w-4 h-4 text-amber-500" />);
      } else {
        showToast('最適化完了', <Award className="w-4 h-4 text-[#4da6ff]" />);
      }
    } catch (err: any) {
      showToast('エラーが発生しました', <XCircle className="w-4 h-4 text-[#ff5c5c]" />);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadFile = () => {
    if (!state.outputCode) return;
    const blob = new Blob([state.outputCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.mode === 'html' ? 'index.min.html' : 'bundled.js';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    if (!state.outputCode) return;
    navigator.clipboard.writeText(state.outputCode).then(() => {
      showToast('コピーしました', <Copy className="w-4 h-4 text-[#4da6ff]" />);
    });
  };

  return (
    <>
      <Header />
      <main className="gap-6 flex-1 grid grid-cols-1 lg:grid-cols-12 max-w-7xl mx-auto px-4 py-6 w-full">
        <div className="flex flex-col gap-6 lg:col-span-5 lg:h-[calc(100vh-140px)]">
          <div className="shrink-0">
            <DropZone onLoadFiles={loadFiles} />
          </div>
          {/* ここから下の要素がスクロール可能になる */}
          <div className="flex-1 min-h-0 flex flex-col gap-6 overflow-y-auto custom-scrollbar pb-2 pr-1">
            <ConfigPanel 
              state={state} 
              dispatch={dispatch} 
              onCompile={runCompile} 
              isLoading={isLoading} 
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 h-[calc(100vh-140px)] lg:col-span-7 min-h-[600px]">
          <AnimatePresence>
            {stats && <Scoreboard stats={stats} />}
          </AnimatePresence>
          <EditorPane 
            state={state}
            dispatch={dispatch}
            logs={logs}
            isLoading={isLoading}
            onCopy={copyToClipboard}
            onDownload={downloadFile}
          />
        </div>
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-900/95 border border-white/10 shadow-2xl text-xs backdrop-blur-xl"
          >
            <span>{toast.icon}</span><span className="font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
