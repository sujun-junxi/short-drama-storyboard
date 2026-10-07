export type CompatStep = 'full' | 'no-response-format' | 'no-stream'

export declare const COMPAT_STEPS: {
  FULL: 'full'
  NO_RESPONSE_FORMAT: 'no-response-format'
  NO_STREAM: 'no-stream'
}

export declare function isLikelyUnsupportedParam(status: number, bodyText: unknown): boolean
export declare function nextCompatibilityStep(
  step: CompatStep,
  ctx: { status: number; bodyText: unknown; streamCapable: boolean },
): CompatStep | null
export declare function applyCompatStep<T extends Record<string, unknown>>(body: T, step: CompatStep): T
