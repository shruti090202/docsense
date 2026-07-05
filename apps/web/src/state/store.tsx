import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { Citation, ContractFacts, CostResponse, DocumentKind, LoanTerms, Outline, PiiMap, RiskFlag, SourceType, ToolCallRecord } from '@docsense/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  // masked text exactly as exchanged with the server; unmasked only at render time
  content: string;
  citations?: Citation[];
  toolCalls?: ToolCallRecord[];
  grounded?: boolean;
  cached?: boolean;
  pending?: boolean;
  error?: string;
}

export interface Highlight {
  chunkId: string;
  page: number;
  pageEnd: number;
  nonce: number;
}

export type AnalysisStatus = 'idle' | 'extracting' | 'reviewing' | 'done' | 'error';

export interface LoadedDoc {
  id: string;
  title: string;
  sourceType: SourceType;
  kind: DocumentKind;
  pageCount: number;
  chunkCount: number;
  isSample: boolean;
  piiMap: PiiMap;
  file: Blob;
  warnings: string[];
  terms: LoanTerms | null;
  cost: CostResponse | null;
  contractFacts: ContractFacts | null;
  outline: Outline | null;
  risks: RiskFlag[] | null;
  analysis: AnalysisStatus;
  analysisError?: string;
  chat: ChatMessage[];
  highlight: Highlight | null;
}

export type View = { kind: 'home' } | { kind: 'document'; id: string } | { kind: 'compare' };

export interface State {
  docs: Record<string, LoadedDoc>;
  order: string[];
  view: View;
  toast: { id: number; kind: 'error' | 'info'; text: string } | null;
}

export type Action =
  | { type: 'doc/add'; doc: LoadedDoc }
  | { type: 'doc/remove'; id: string }
  | { type: 'doc/analysis'; id: string; status: AnalysisStatus; error?: string }
  | { type: 'doc/terms'; id: string; terms: LoanTerms; cost: CostResponse }
  | { type: 'doc/facts'; id: string; facts: ContractFacts }
  | { type: 'doc/outline'; id: string; outline: Outline }
  | { type: 'doc/risks'; id: string; risks: RiskFlag[] }
  | { type: 'chat/append'; id: string; message: ChatMessage }
  | { type: 'chat/update'; id: string; messageId: string; patch: Partial<ChatMessage> }
  | { type: 'highlight'; id: string; highlight: Highlight | null }
  | { type: 'view'; view: View }
  | { type: 'toast'; kind: 'error' | 'info'; text: string }
  | { type: 'toast/clear' };

const initial: State = { docs: {}, order: [], view: { kind: 'home' }, toast: null };

function patchDoc(state: State, id: string, patch: (d: LoadedDoc) => LoadedDoc): State {
  const doc = state.docs[id];
  if (!doc) return state;
  return { ...state, docs: { ...state.docs, [id]: patch(doc) } };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'doc/add': {
      const exists = state.docs[action.doc.id];
      return {
        ...state,
        docs: { ...state.docs, [action.doc.id]: exists ? { ...exists, file: action.doc.file, piiMap: action.doc.piiMap } : action.doc },
        order: exists ? state.order : [...state.order, action.doc.id],
        view: { kind: 'document', id: action.doc.id },
      };
    }
    case 'doc/remove': {
      const { [action.id]: _removed, ...docs } = state.docs;
      const order = state.order.filter((x) => x !== action.id);
      const view: View = state.view.kind === 'document' && state.view.id === action.id ? { kind: 'home' } : state.view;
      return { ...state, docs, order, view };
    }
    case 'doc/analysis':
      return patchDoc(state, action.id, (d) => ({ ...d, analysis: action.status, ...(action.error ? { analysisError: action.error } : {}) }));
    case 'doc/terms':
      return patchDoc(state, action.id, (d) => ({ ...d, terms: action.terms, cost: action.cost }));
    case 'doc/facts':
      return patchDoc(state, action.id, (d) => ({ ...d, contractFacts: action.facts }));
    case 'doc/outline':
      return patchDoc(state, action.id, (d) => ({ ...d, outline: action.outline }));
    case 'doc/risks':
      return patchDoc(state, action.id, (d) => ({ ...d, risks: action.risks }));
    case 'chat/append':
      return patchDoc(state, action.id, (d) => ({ ...d, chat: [...d.chat, action.message] }));
    case 'chat/update':
      return patchDoc(state, action.id, (d) => ({ ...d, chat: d.chat.map((m) => (m.id === action.messageId ? { ...m, ...action.patch } : m)) }));
    case 'highlight':
      return patchDoc(state, action.id, (d) => ({ ...d, highlight: action.highlight }));
    case 'view':
      return { ...state, view: action.view };
    case 'toast':
      return { ...state, toast: { id: Date.now(), kind: action.kind, text: action.text } };
    case 'toast/clear':
      return { ...state, toast: null };
  }
}

const StateContext = createContext<State>(initial);
const DispatchContext = createContext<Dispatch<Action>>(() => undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export const useStore = () => useContext(StateContext);
export const useDispatch = () => useContext(DispatchContext);
