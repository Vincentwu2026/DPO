import { describe, expect, it } from 'vitest'
import { isValidCameraIndex, isValidStability, parseTrackerLine } from '../tracker/protocol'

describe('parseTrackerLine', () => {
  it('parses a valid gaze event', () => {
    expect(
      parseTrackerLine('{"type":"gaze","ts":1700000000.123,"zone":"camera","confidence":0.91}')
    ).toEqual({ type: 'gaze', ts: 1700000000.123, zone: 'camera', confidence: 0.91 })
  })

  it('parses ready, error and devices messages', () => {
    expect(parseTrackerLine('{"type":"ready","version":"0.1.0"}')).toEqual({
      type: 'ready',
      version: '0.1.0'
    })
    expect(parseTrackerLine('{"type":"error","message":"Cannot open camera 7"}')).toEqual({
      type: 'error',
      message: 'Cannot open camera 7'
    })
    expect(
      parseTrackerLine('{"type":"devices","list":[{"index":0,"name":"MacBook Pro Camera"}]}')
    ).toEqual({ type: 'devices', list: [{ index: 0, name: 'MacBook Pro Camera' }] })
  })

  it('drops invalid devices but keeps valid ones', () => {
    const msg = parseTrackerLine(
      '{"type":"devices","list":[{"index":-1,"name":"a"},{"index":2},{"index":3,"name":"ok"},null]}'
    )
    expect(msg).toEqual({ type: 'devices', list: [{ index: 3, name: 'ok' }] })
  })

  it.each([
    '',
    'not json',
    '[]',
    'null',
    '{"type":"unknown"}',
    '{"type":"gaze","ts":"1","zone":"camera","confidence":0.5}',
    '{"type":"gaze","ts":1,"zone":"sideways","confidence":0.5}',
    '{"type":"gaze","ts":1,"zone":"camera","confidence":1.5}',
    '{"type":"gaze","ts":1,"zone":"camera","confidence":-0.1}',
    '{"type":"gaze","ts":1,"zone":"camera"}',
    '{"type":"devices","list":"x"}',
    '{"type":"error"}',
    '{"type":"ready"}'
  ])('rejects malformed input %j', (line) => {
    expect(parseTrackerLine(line)).toBeNull()
  })

  it('truncates very long text fields', () => {
    const msg = parseTrackerLine(JSON.stringify({ type: 'error', message: 'x'.repeat(5000) }))
    expect(msg?.type === 'error' && msg.message.length).toBe(200)
  })
})

describe('isValidStability', () => {
  it.each(['responsive', 'balanced', 'steady'])('accepts %s', (v) =>
    expect(isValidStability(v)).toBe(true)
  )
  it.each(['extreme', '', 'Balanced', 1, null, undefined])('rejects %j', (v) =>
    expect(isValidStability(v)).toBe(false)
  )
})

describe('isValidCameraIndex', () => {
  it.each([0, 5, 9])('accepts %d', (v) => expect(isValidCameraIndex(v)).toBe(true))
  it.each([-1, 10, 1.5, '1', null, undefined, NaN])('rejects %j', (v) =>
    expect(isValidCameraIndex(v)).toBe(false)
  )
})
