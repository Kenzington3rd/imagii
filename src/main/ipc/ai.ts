import { ipcMain, shell } from 'electron'
import {
  getInstallStatus,
  runTxt2Img,
  runInpaint,
  runOutpaint
} from '../sidecars/sdManager'
import { checkPrompt } from '../safety/promptFilter'
import type { Txt2ImgRequest, InpaintRequest, OutpaintRequest } from '../../shared/ai'
import { pathToImagiiFileUrl } from '../protocol'

export function registerAiIpc(): void {
  ipcMain.handle('ai:status', () => getInstallStatus())

  ipcMain.handle('ai:checkPrompt', (_e, prompt: string) => checkPrompt(prompt))

  ipcMain.handle('ai:txt2img', async (e, req: Txt2ImgRequest) => {
    const safety = checkPrompt(req.prompt)
    if (!safety.allowed) {
      e.sender.send('ai:progress', {
        jobId: req.jobId,
        phase: 'safety',
        message: safety.friendlyMessage
      })
      throw new Error(safety.friendlyMessage)
    }
    const result = await runTxt2Img(req, (p) => e.sender.send('ai:progress', p))
    return {
      ...result,
      images: result.images.map((img) => ({ ...img, url: pathToImagiiFileUrl(img.path) }))
    }
  })

  ipcMain.handle('ai:inpaint', async (e, req: InpaintRequest) => {
    const safety = checkPrompt(req.prompt)
    if (!safety.allowed) throw new Error(safety.friendlyMessage)
    const result = await runInpaint(req, (p) => e.sender.send('ai:progress', p))
    return {
      ...result,
      images: result.images.map((img) => ({ ...img, url: pathToImagiiFileUrl(img.path) }))
    }
  })

  ipcMain.handle('ai:outpaint', async (e, req: OutpaintRequest) => {
    const safety = checkPrompt(req.prompt)
    if (!safety.allowed) throw new Error(safety.friendlyMessage)
    const result = await runOutpaint(req, (p) => e.sender.send('ai:progress', p))
    return {
      ...result,
      images: result.images.map((img) => ({ ...img, url: pathToImagiiFileUrl(img.path) }))
    }
  })

  ipcMain.handle('ai:openModelsFolder', async () => {
    const status = await getInstallStatus()
    shell.openPath(status.modelsDir)
  })

  ipcMain.handle('ai:openBinFolder', async () => {
    const status = await getInstallStatus()
    shell.openPath(status.resourcesBinDir)
  })
}
