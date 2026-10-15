import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationDirectory = fileURLToPath(new URL('../../drizzle/', import.meta.url));

function valueForSqlite(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value === null || typeof value === 'string' || typeof value === 'number' || ArrayBuffer.isView(value)) return value;
  throw new TypeError(`Unsupported D1 bound value: ${typeof value}`);
}

function rowObject(row) {
  return row ? Object.fromEntries(Object.entries(row)) : null;
}

/** D1's async statement API, backed by actual in-memory SQLite queries. */
class TestStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestStatement(this.database, this.sql, values.map(valueForSqlite));
  }

  async first(column) {
    const row = rowObject(this.database.prepare(this.sql).get(...this.values));
    if (column === undefined) return row;
    if (row === null) return null;
    if (!(column in row)) throw new Error(`D1 column not found: ${column}`);
    return row[column];
  }

  execute(includeResults) {
    const statement = this.database.prepare(this.sql);
    const before = this.database.prepare('SELECT total_changes() AS changes').get().changes;
    let results = [];
    if (statement.columns().length) {
      const rows = statement.all(...this.values).map(rowObject);
      if (includeResults) results = rows;
    } else {
      statement.run(...this.values);
    }
    const changes = this.database.prepare('SELECT total_changes() AS changes').get().changes - before;
    const lastRowId = this.database.prepare('SELECT last_insert_rowid() AS id').get().id;
    return {
      success: true,
      results,
      meta: {
        changes,
        last_row_id: lastRowId,
        changed_db: changes > 0,
        duration: 0,
        rows_read: results.length,
        rows_written: changes,
        size_after: 0,
      },
    };
  }

  async all() {
    return this.execute(true);
  }

  async run() {
    return this.execute(false);
  }

  async raw({ columnNames = false } = {}) {
    const statement = this.database.prepare(this.sql);
    statement.setReturnArrays(true);
    const rows = statement.all(...this.values);
    return columnNames ? [statement.columns().map(column => column.name), ...rows] : rows;
  }
}

/** Apply the repository's real migrations, optionally stopping at a legacy schema. */
export function applyMigrations(binding, { after, through } = {}) {
  const files = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) {
    if ((after && name <= after) || (through && name > through) || binding.appliedMigrations.includes(name)) continue;
    binding.sqlite.exec(readFileSync(`${migrationDirectory}/${name}`, 'utf8'));
    binding.appliedMigrations.push(name);
  }
  return binding;
}

/**
 * No query-result stubs: repository code receives the same prepare/bind API as
 * D1 while migrations, constraints and compare-and-swap writes execute in SQLite.
 */
export function createTestD1({ migrations = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const binding = {
    sqlite,
    appliedMigrations: [],
    prepare(sql) {
      return new TestStatement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute(true));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: sql.split(';').filter(part => part.trim()).length, duration: 0 };
    },
    close() {
      sqlite.close();
    },
  };
  if (migrations) applyMigrations(binding, typeof migrations === 'object' ? migrations : {});
  return binding;
}
