export type AppState = {
  files: Map<string, string>;
  mode: 'html' | 'smart' | 'direct';
  config: {
    htmlOptCss: boolean;
    htmlOptJs: boolean;
    htmlOptImg: boolean;
    golfEnabled: boolean;
    enableMangle: boolean;
    terserCompress: boolean;
    stage1Depth: number;
    stage2Depth: number;
    patience: number;
    enableBeamSearch: boolean;
    beamWidth: number;
    maxIterations: number;
    enabledRuleIds: Record<string, boolean>;
    addStrict: boolean;
    directLang: string;
    htmlEntry: string;
    includeNodeModules?: boolean;
    excludePatternsStr?: string;
    cdnTemplate?: string;
  };
  editorTab: 'input' | 'output';
  inputCode: string;
  outputCode: string;
};

export type AppAction =
  | { type: 'SET_FILES'; files: Map<string, string> }
  | { type: 'SET_MODE'; mode: 'html' | 'smart' | 'direct' }
  | { type: 'SET_CONFIG'; key: keyof AppState['config']; value: any }
  | { type: 'SET_EDITOR_TAB'; tab: 'input' | 'output' }
  | { type: 'SET_INPUT'; code: string }
  | { type: 'SET_OUTPUT'; code: string }
  | { type: 'RESET' };
