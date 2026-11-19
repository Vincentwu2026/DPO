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

describe('parseTrackerLine calibration messages', () => {
  const update = {
    type: 'calibration',
    face: true,
    h: 0.51,
    v: 0.01,
    yaw: 2,
    pitch: -1,
    zone: 'camera',
    phase: 'camera',
    camera_samples: 12,
    screen_samples: 0,
    preview: 'QUJD'
  }
  const thresholds = {
    h_center: 0.5,
    h_tolerance: 0.08,
    v_center: 0,
    v_tolerance: 0.05,
    yaw_center: 0,
    pitch_center: 0,
    camera_max_yaw: 15,
    camera_max_pitch: 15,
    away_yaw: 40,
    away_pitch: 35
  }
  const result = {
    type: 'calibration_result',
    ok: true,
    good: true,
    camera_samples: 40,
    screen_samples: 41,
    camera_hit: 0.97,
    screen_hit: 0.9,
    thresholds
  }
  const parse = (o: unknown): ReturnType<typeof parseTrackerLine> =>
    parseTrackerLine(JSON.stringify(o))

  it('parses a live update into camelCase', () => {
    expect(parse(update)).toEqual({
      type: 'calibration',
      face: true,
      h: 0.51,
      v: 0.01,
      yaw: 2,
      pitch: -1,
      zone: 'camera',
      phase: 'camera',
      cameraSamples: 12,
      screenSamples: 0,
      preview: 'QUJD'
    })
  })

  it('accepts no face, no phase and no preview', () => {
    const msg = parse({
      ...update,
      face: false,
      h: null,
      v: null,
      yaw: null,
      pitch: null,
      phase: null,
      preview: null
    })
    expect(msg).toMatchObject({
      type: 'calibration',
      face: false,
      h: null,
      phase: null,
      preview: null
    })
  })

  it.each([
    ['face is not a boolean', { face: 1 }],
    ['unknown zone', { zone: 'sideways' }],
    ['unknown phase', { phase: 'up' }],
    ['non-finite reading', { h: 'x' }],
    ['absurd reading', { yaw: 1e9 }],
    ['negative count', { camera_samples: -1 }],
    ['fractional count', { screen_samples: 1.5 }],
    ['preview that is not base64', { preview: '<script>alert(1)</script>' }],
    ['oversized preview', { preview: 'A'.repeat(200_001) }]
  ])('rejects an update where %s', (_name, patch) => {
    expect(parse({ ...update, ...patch })).toBeNull()
  })

  it('parses a fit result', () => {
    expect(parse(result)).toEqual({
      type: 'calibration_result',
      result: {
        good: true,
        cameraSamples: 40,
        screenSamples: 41,
        cameraHit: 0.97,
        screenHit: 0.9,
        thresholds
      }
    })
  })

  it('parses a "not enough data" result', () => {
    expect(parse({ type: 'calibration_result', ok: false })).toEqual({
      type: 'calibration_result',
      result: null
    })
  })

  it.each([
    ['out-of-range threshold', { thresholds: { ...thresholds, h_center: 9 } }],
    ['missing threshold', { thresholds: { h_center: 0.5 } }],
    ['overlapping away zone', { thresholds: { ...thresholds, away_yaw: 16 } }],
    ['hit rate above 1', { camera_hit: 1.5 }],
    ['non-boolean good', { good: 'yes' }],
    ['unknown ok', { ok: 'maybe' }]
  ])('rejects a result with %s', (_name, patch) => {
    expect(parse({ ...result, ...patch })).toBeNull()
  })
})
