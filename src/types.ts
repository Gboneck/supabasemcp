export interface TableInfo {
  schema: string;
  name: string;
  column_count: number;
  estimated_row_count: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_primary_key: boolean;
}

export interface ForeignKeyInfo {
  column: string;
  references_table: string;
  references_column: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  foreign_keys: ForeignKeyInfo[];
  indexes: IndexInfo[];
}

export interface ProjectInfo {
  url: string;
  is_read_only: boolean;
  allowed_tables: string[] | null;
  blocked_tables: string[];
  write_rate_limit: number;
}

export interface FileUrl {
  url: string;
  is_signed: boolean;
}

export interface ServerConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  readOnly: boolean;
  allowedTables: string[] | null;
  blockedTables: string[];
  writeRateLimit: number;
}
