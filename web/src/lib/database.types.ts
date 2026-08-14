export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type StrategyRow = {
  id: string;
  user_id: string;
  name: string;
  pair: string;
  tf: string;
  notes: string | null;
  engine: string | null;
  engine_params: Record<string, number>;
  created_at: string;
  updated_at: string;
};

export type StrategyDrawingRow = {
  strategy_id: string;
  user_id: string;
  payload: Json;
  updated_at: string;
};

export type PineScriptRow = {
  id: string;
  user_id: string;
  name: string;
  source: string;
  created_at: string;
  updated_at: string;
};

export type StrategyPineOverlayRow = {
  strategy_id: string;
  script_id: string;
  user_id: string;
  created_at: string;
};

export type BacktestRunRow = {
  id: string;
  strategy_id: string;
  user_id: string;
  engine: string;
  params: Record<string, number>;
  tf: string;
  start_at: string | null;
  end_at: string | null;
  result: Json;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string | null; created_at: string };
        Insert: { id: string; email?: string | null; created_at?: string };
        Update: { email?: string | null };
      };
      strategies: {
        Row: StrategyRow;
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          pair?: string;
          tf?: string;
          notes?: string | null;
          engine?: string | null;
          engine_params?: Record<string, number>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          pair?: string;
          tf?: string;
          notes?: string | null;
          engine?: string | null;
          engine_params?: Record<string, number>;
          updated_at?: string;
        };
      };
      strategy_drawings: {
        Row: StrategyDrawingRow;
        Insert: {
          strategy_id: string;
          user_id: string;
          payload?: Json;
          updated_at?: string;
        };
        Update: { payload?: Json; updated_at?: string };
      };
      backtest_runs: {
        Row: BacktestRunRow;
        Insert: {
          id?: string;
          strategy_id: string;
          user_id: string;
          engine: string;
          params?: Record<string, number>;
          tf: string;
          start_at?: string | null;
          end_at?: string | null;
          result?: Json;
          created_at?: string;
        };
        Update: never;
      };
      pine_scripts: {
        Row: PineScriptRow;
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: { name?: string; source?: string; updated_at?: string };
      };
      strategy_pine_overlays: {
        Row: StrategyPineOverlayRow;
        Insert: {
          strategy_id: string;
          script_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: never;
      };
    };
  };
};
