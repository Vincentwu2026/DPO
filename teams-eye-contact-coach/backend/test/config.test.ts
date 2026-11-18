import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const base = {
  AZURE_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  API_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  DATABASE_URL: 'postgres://user:hunter2@db.example.com:5432/coach'
}

describe('loadConfig', () => {
  it('applies safe defaults: loopback bind, TLS to the database, no CORS origins', () => {
    const c = loadConfig(base)
    expect(c.host).toBe('127.0.0.1')
    expect(c.port).toBe(3000)
    expect(c.databaseSsl).toBe(true)
    expect(c.corsOrigins).toEqual([])
    expect(c.trustProxy).toBe(false)
    expect(c.requiredScope).toBe('Sessions.ReadWrite')
  })

  it('parses exact CORS origins', () => {
    const c = loadConfig({
      ...base,
      CORS_ORIGINS: 'https://dash.example.com, http://localhost:5173'
    })
    expect(c.corsOrigins).toEqual(['https://dash.example.com', 'http://localhost:5173'])
  })

  it.each(['*', 'https://dash.example.com/', 'https://dash.example.com/path', 'dash.example.com'])(
    'rejects CORS origin %j',
    (origin) => {
      expect(() => loadConfig({ ...base, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/)
    }
  )

  it('names missing variables but never echoes their values', () => {
    let message = ''
    try {
      loadConfig({ DATABASE_URL: base.DATABASE_URL, AZURE_TENANT_ID: 'not-a-uuid' })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('AZURE_TENANT_ID')
    expect(message).toContain('API_CLIENT_ID')
    expect(message).not.toContain('hunter2')
    expect(message).not.toContain('not-a-uuid')
  })

  it('does not leak a malformed DATABASE_URL secret in the error', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow('DATABASE_URL')
  })

  it.each(['0.0.0.0', '::', '[::]'])('refuses to bind to all interfaces (%s)', (host) => {
    expect(() => loadConfig({ ...base, HOST: host })).toThrow(/HOST/)
  })

  it.each(['0', '70000', 'abc'])('rejects PORT %s', (port) => {
    expect(() => loadConfig({ ...base, PORT: port })).toThrow(/PORT/)
  })
})
