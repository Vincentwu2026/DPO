import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCameraIndex } from '../tracker/resolveCamera'

describe('resolveCameraIndex', () => {
  afterEach(() => vi.useRealTimers())

  it('falls back to camera 0 when the Teams lookup takes too long', async () => {
    vi.useFakeTimers()
    const pending = resolveCameraIndex(
      { cameraAuto: true, cameraIndex: 3 },
      () => new Promise<number>(() => undefined),
      1000
    )
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toBe(0)
  })

  it('uses the explicitly chosen camera without asking Teams', async () => {
    const getTeamsIndex = vi.fn().mockResolvedValue(2)
    await expect(
      resolveCameraIndex({ cameraAuto: false, cameraIndex: 1 }, getTeamsIndex)
    ).resolves.toBe(1)
    expect(getTeamsIndex).not.toHaveBeenCalled()
  })

  it('follows the Teams camera in automatic mode', async () => {
    await expect(
      resolveCameraIndex({ cameraAuto: true, cameraIndex: 0 }, () => Promise.resolve(2))
    ).resolves.toBe(2)
  })

  it('falls back to camera 0 when Teams lookup fails or returns an invalid index', async () => {
    const auto = { cameraAuto: true, cameraIndex: 3 }
    await expect(resolveCameraIndex(auto, () => Promise.reject(new Error('x')))).resolves.toBe(0)
    await expect(resolveCameraIndex(auto, () => Promise.resolve(42))).resolves.toBe(0)
    await expect(resolveCameraIndex(auto, () => Promise.resolve(-1))).resolves.toBe(0)
  })
})
