import type { Mode, PermissionMode } from './types'

export function permissionPolicy(mode: Mode, requested?: PermissionMode) {
  const permission = requested === 'full-access' || requested === 'read-only' ? requested : 'ask'
  return {
    permission,
    canRead: mode === 'code' || mode === 'ask',
    canWrite: mode === 'code' && permission !== 'read-only',
    needsApproval: mode !== 'code' || permission !== 'full-access',
  }
}
