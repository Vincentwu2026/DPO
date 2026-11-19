import { describe, expect, it } from 'vitest'
import { parseDashboardUrl } from '../report/dashboardUrl'

describe('parseDashboardUrl', () => {
  it('accepts https and loopback http only', () => {
    expect(parseDashboardUrl('https://dash.example.com')).toBe('https://dash.example.com/')
    expect(parseDashboardUrl('http://localhost:5173')).toBe('http://localhost:5173/')
    expect(parseDashboardUrl('http://dash.example.com')).toBeNull()
    expect(parseDashboardUrl('javascript:alert(1)')).toBeNull()
    expect(parseDashboardUrl('file:///etc/passwd')).toBeNull()
    expect(parseDashboardUrl('not a url')).toBeNull()
    expect(parseDashboardUrl(undefined)).toBeNull()
    expect(parseDashboardUrl('')).toBeNull()
  })
})
