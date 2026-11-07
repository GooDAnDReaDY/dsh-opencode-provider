import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_MAX_IMAGES,
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
} from './config.ts'

export interface ResolvedImage {
  readonly mediaType: string
  readonly base64: string
  readonly dataUrl: string
  readonly width: number
  readonly height: number
}

export type ImageMap = ReadonlyMap<string, ResolvedImage>

const MAX_LONG_EDGE = 1_568

export interface ImagePolicy {
  readonly maxImages?: number
  readonly maxRequestImageBytes?: number
  readonly requestImagePixelBudget?: number
  readonly requestImageMaxBytes?: number
}

function limitsOf(policy: ImagePolicy | undefined): Required<ImagePolicy> {
  return {
    maxImages: policy?.maxImages ?? DEFAULT_MAX_IMAGES,
    maxRequestImageBytes: policy?.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: policy?.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: policy?.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  }
}

export interface SelectedRequestImages {
  readonly kept: readonly ImageAttachmentRef[]
  readonly dropped: readonly ImageAttachmentRef[]
  readonly allowedOccurrences?: ReadonlyMap<string, number>
}

export function normalizedEncodedBytes(ref: ImageAttachmentRef, policy?: ImagePolicy): number {
  const targetBytes = policy?.requestImageMaxBytes
  const raw = ref.bytes > 0 ? ref.bytes : 0
  const effective = targetBytes !== undefined && targetBytes > 0
    ? Math.min(raw, targetBytes)
    : raw
  return Math.ceil(effective * 4 / 3)
}

export function selectRequestImages(
  refs: readonly ImageAttachmentRef[],
  occurrences?: ReadonlyMap<string, number>,
  policy?: ImagePolicy,
): SelectedRequestImages {
  const limits = limitsOf(policy)
  const unique: ImageAttachmentRef[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref.attachmentId)) continue
    seen.add(ref.attachmentId)
    unique.push(ref)
  }

  const countOf = (ref: ImageAttachmentRef): number =>
    Math.max(1, occurrences?.get(ref.attachmentId) ?? 1)
  const encoded = (bytes: number): number => Math.ceil(Math.max(0, bytes) * 4 / 3)

  let start = 0
  let totalImages = unique.reduce((sum, ref) => sum + countOf(ref), 0)
  let bytes = unique.reduce((sum, ref) => sum + encoded(ref.bytes) * countOf(ref), 0)
  while (start < unique.length
    && (totalImages > limits.maxImages || bytes > limits.maxRequestImageBytes)) {
    const dropped = unique[start]
    if (dropped !== undefined) {
      const count = countOf(dropped)
      totalImages -= count
      bytes -= encoded(dropped.bytes) * count
    }
    start += 1
  }

  const keptList = unique.slice(start)
  let kept: ImageAttachmentRef[]
  let dropped: ImageAttachmentRef[]

  if (keptList.length === 0 && unique.length > 0) {
    kept = unique.slice(-1)
    dropped = unique.slice(0, -1)
  } else {
    kept = keptList
    dropped = unique.slice(0, start)
  }

  const allowed = new Map<string, number>()
  for (const ref of dropped) {
    allowed.set(ref.attachmentId, 0)
  }
  let remainingSlots = limits.maxImages
  let remainingBytes = limits.maxRequestImageBytes
  for (let i = kept.length - 1; i >= 0; i--) {
    const ref = kept[i]!
    const count = countOf(ref)
    const cost = normalizedEncodedBytes(ref, policy)
    const maxByCount = Math.min(count, remainingSlots)
    const maxByBytes = cost > 0 ? Math.floor(remainingBytes / cost) : count
    const isIndividuallyOversized = cost > limits.maxRequestImageBytes
    const maxAllowed = isIndividuallyOversized ? 0 : Math.max(1, Math.min(maxByCount, maxByBytes))
    const finalAllowed = Math.min(count, Math.min(limits.maxImages, maxAllowed))
    allowed.set(ref.attachmentId, finalAllowed)
    remainingSlots = Math.max(0, remainingSlots - finalAllowed)
    remainingBytes = Math.max(0, remainingBytes - finalAllowed * cost)
  }

  return { kept, dropped, allowedOccurrences: allowed }
}

export function applyImageBudget(
  options: GenerateOptions,
  selected: SelectedRequestImages,
): GenerateOptions {
  if (selected.allowedOccurrences === undefined) return options
  const remaining = new Map(selected.allowedOccurrences)

  const clonedMessages = options.messages.map((message) => ({
    ...message,
    content: [...message.content],
  }))

  for (let m = clonedMessages.length - 1; m >= 0; m--) {
    const msg = clonedMessages[m]!
    for (let b = msg.content.length - 1; b >= 0; b--) {
      const block = msg.content[b]!
      if (block.type === 'image' && block.offloaded !== true) {
        const id = block.attachment.attachmentId
        const allowed = remaining.get(id) ?? 0
        if (allowed > 0) {
          remaining.set(id, allowed - 1)
        } else {
          msg.content[b] = { ...block, offloaded: true }
        }
      }
    }
  }

  return { ...options, messages: clonedMessages }
}

function targetOf(ref: ImageAttachmentRef, policy?: ImagePolicy): { width: number; height: number; maxBytes: number } {
  const limits = limitsOf(policy)
  const longEdge = Math.max(ref.width, ref.height)
  const pixelEdge = Math.max(1, Math.floor(Math.sqrt(limits.requestImagePixelBudget)))
  const maxEdge = Math.min(MAX_LONG_EDGE, pixelEdge)
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1
  return {
    width: Math.max(1, Math.round(ref.width * scale)),
    height: Math.max(1, Math.round(ref.height * scale)),
    maxBytes: limits.requestImageMaxBytes,
  }
}

export function hasImages(options: GenerateOptions): boolean {
  for (const message of options.messages) {
    for (const block of message.content) {
      if (block.type === 'image' && block.offloaded !== true) return true
    }
  }
  return false
}

export async function resolveImages(
  options: GenerateOptions,
  store: AttachmentStore,
  signal: AbortSignal | undefined,
  policy?: ImagePolicy,
): Promise<{ images: ImageMap; bodyOptions: GenerateOptions }> {
  const refs: ImageAttachmentRef[] = []
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const message of options.messages) {
    for (const block of message.content) {
      if (block.type !== 'image' || block.offloaded === true) continue
      const ref = block.attachment
      counts.set(ref.attachmentId, (counts.get(ref.attachmentId) ?? 0) + 1)
      if (seen.has(ref.attachmentId)) continue
      seen.add(ref.attachmentId)
      refs.push(ref)
    }
  }

  const selected = selectRequestImages(refs, counts, policy)
  const bodyOptions = applyImageBudget(options, selected)

  const images = new Map<string, ResolvedImage>()
  for (const ref of selected.kept) {
    if ((selected.allowedOccurrences?.get(ref.attachmentId) ?? 1) <= 0) continue
    const request = await store.readImageRequest(ref, targetOf(ref, policy), signal)
    const base64 = Buffer.from(request.data).toString('base64')
    images.set(ref.attachmentId, {
      mediaType: request.mediaType,
      base64,
      dataUrl: `data:${request.mediaType};base64,${base64}`,
      width: request.width,
      height: request.height,
    })
  }
  return { images, bodyOptions }
}

export function offloadPlaceholder(ref: ImageAttachmentRef): string {
  return `[image omitted: ${ref.name ?? ref.attachmentId}]`
}
