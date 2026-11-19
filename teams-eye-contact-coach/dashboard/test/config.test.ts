import { describe, expect, it } from 'vitest'
import { isAllowedApiUrl, loadConfig } from '../src/config'

const valid = {
  VITE_AZURE_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  VITE_DASHBOARD_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  VITE_API_SCOPE: 'api://33333333-3333-4333-8333-333333333333/Sessions.ReadWrite',
  VITE_API_BASE_URL: 'https://api.example.com/'
}

describe('isAllowedApiUrl', () => {
  it('allows https and loopback http only', () => {
    expect(isAllowedApiUrl('https://api.example.com')).toBe(true)
    expect(isAllowedApiUrl('http://localhost:3000')).toBe(true)
    expect(isAllowedApiUrl('http://127.0.0.1:3000')).toBe(true)
    expect(isAllowedApiUrl('http://api.example.com')).toBe(false)
    expect(isAllowedApiUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedApiUrl('not a url')).toBe(false)
  })
})

describe('loadConfig', () => {
  it('parses and strips trailing slashes', () => {
    expect(loadConfig(valid).apiBaseUrl).toBe('https://api.example.com')
  })

  it('names the bad variable but never its value', () => {
    const bad = { ...valid, VITE_API_BASE_URL: 'http://insecure.example.com' }
    expect(() => loadConfig(bad)).toThrow('VITE_API_BASE_URL')
    expect(() => loadConfig(bad)).not.toThrow(/insecure/)
  })

  it('rejects a missing client id', () => {
    const rest: Record<string, string> = { ...valid }
    delete rest['VITE_DASHBOARD_CLIENT_ID']
    expect(() => loadConfig(rest)).toThrow('VITE_DASHBOARD_CLIENT_ID')
  })
})
