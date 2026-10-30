import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permissionPolicy } from '../src/shared/permissions'
import type { PermissionMode } from '../src/shared/types'

test('existing chats and unknown permission values require approval', () => {
  const values: (PermissionMode | undefined)[] = [undefined, 'ask', 'anything' as PermissionMode]
  for (const value of values) {
    const policy = permissionPolicy('code', value)
    assert.equal(policy.canWrite, true)
    assert.equal(policy.needsApproval, true)
  }
})
test('full access applies only to Code, while Chat and Ask keep their tool boundaries', () => {
  assert.deepEqual(permissionPolicy('code', 'full-access'), { permission: 'full-access', canRead: true, canWrite: true, needsApproval: false })
  assert.equal(permissionPolicy('chat', 'full-access').canRead, false)
  assert.equal(permissionPolicy('chat', 'full-access').canWrite, false)
  assert.equal(permissionPolicy('ask', 'full-access').canWrite, false)
  assert.equal(permissionPolicy('code', 'read-only').canRead, true)
  assert.equal(permissionPolicy('code', 'read-only').canWrite, false)
})
