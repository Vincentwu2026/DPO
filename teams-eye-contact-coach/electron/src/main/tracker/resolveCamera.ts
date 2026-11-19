export interface CameraChoice {
  cameraAuto: boolean
  cameraIndex: number
}

/**
 * Picks the camera index to track on. A camera the user chose explicitly always wins;
 * otherwise follow the camera Teams uses (which is 0 when that cannot be determined).
 */
export async function resolveCameraIndex(
  choice: CameraChoice,
  getTeamsIndex: () => Promise<number>,
  timeoutMs = 5_000
): Promise<number> {
  if (!choice.cameraAuto) return choice.cameraIndex
  let timer: NodeJS.Timeout | undefined
  try {
    // A cold lookup probes the cameras through the tracker binary; do not make a call wait on it.
    const index = await Promise.race([
      getTeamsIndex(),
      new Promise<number>((resolve) => {
        timer = setTimeout(() => resolve(0), timeoutMs)
      })
    ])
    return Number.isInteger(index) && index >= 0 && index <= 9 ? index : 0
  } catch {
    return 0
  } finally {
    clearTimeout(timer)
  }
}
