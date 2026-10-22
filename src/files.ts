import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'

/**
 * Model-facing handle for a file when the adapter receives a raw FileBlock.
 * The harness normally projects files to text with an execution-world path
 * before dispatch; this is the safe fallback for direct adapter calls.
 */
export function filePlaceholder(ref: FileAttachmentRef): string {
  const digest = String(ref.attachmentId).slice(7, 15)
  const name = JSON.stringify(ref.name)
  return `[File ${name} (${ref.bytes} bytes, sha256:${digest}) was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`
}
