import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
  shell: {}
}))

import { pdfFileName } from '../report/ReportWindow'

describe('pdfFileName', () => {
  it('builds a padded local timestamp name without any meeting text', () => {
    expect(pdfFileName(new Date(2026, 0, 5, 3, 4, 9))).toBe(
      'eye-contact-report-2026-01-05-0304-09.pdf'
    )
  })
})
