import { getToolLayout, makeStatus } from '../core/ui.js'
import { createViewer } from '../core/viewer.js'

const { viewerEl, statusEl } = getToolLayout()
createViewer(viewerEl)
makeStatus(statusEl)('To narzędzie jest w budowie…', 'info')
