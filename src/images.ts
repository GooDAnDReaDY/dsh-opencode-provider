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
}

/**
 * Keep the newest images under one request-wide budget. The oldest images are
 * dropped first; the transports render them as an "image omitted" placeholder
 * instead of failing the whole request.
 */
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

  const kept = unique.slice(start)
  // The normalized per-image target keeps a single image small; if a malformed
  // reference still exceeds the budget, keep the newest one rather than sending
  // no image at all.
  if (kept.length === 0 && unique.length > 0) {
    return { kept: unique.slice(-1), dropped: unique.slice(0, -1) }
  }
  return { kept, dropped: unique.slice(0, start) }
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
  return options.messages.some((message) =>
    message.content.some((block) => block.type === 'image' && block.offloaded !== true))
}

/** Decode the distinct request images that fit the request-wide budget. */
export async function resolveImages(
  options: GenerateOptions,
  store: AttachmentStore,
  signal: AbortSignal | undefined,
  policy?: ImagePolicy,
): Promise<ImageMap> {
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

  const images = new Map<string, ResolvedImage>()
  for (const ref of selectRequestImages(refs, counts, policy).kept) {
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
  return images
}

export function offloadPlaceholder(ref: ImageAttachmentRef): string {
  return `[image omitted: ${ref.name ?? ref.attachmentId}]`
}
