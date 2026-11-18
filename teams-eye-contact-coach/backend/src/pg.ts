import { Pool } from 'pg'
import { migrate, type Database, type Queryable } from './db.js'

/** Production database over a `pg` pool. */
export function createPgDatabase(opts: { url: string; ssl: boolean }): Database {
  const pool = new Pool({
    connectionString: opts.url,
    // Verify the server certificate; never disable validation.
    ssl: opts.ssl ? { rejectUnauthorized: true } : false,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000
  })
  // An idle client erroring (e.g. server restart) must not crash the process.
  pool.on('error', () => undefined)

  return {
    query: (text, params) => pool.query(text, params as unknown[] | undefined) as never,
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn({
          query: (t, p) => client.query(t, p as unknown[] | undefined) as never
        })
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end()
  }
}

export async function openDatabase(opts: { url: string; ssl: boolean }): Promise<Database> {
  const db = createPgDatabase(opts)
  await migrate(db)
  return db
}

export type { Queryable }
