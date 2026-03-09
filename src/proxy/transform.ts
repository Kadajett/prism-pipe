/**
 * Transform registry interface
 */

import type { CanonicalRequest, CanonicalResponse } from "@core"

export interface Transform {
  name: string
  transform(req: CanonicalRequest): CanonicalRequest
}

export interface ResponseTransform {
  name: string
  transform(res: CanonicalResponse): CanonicalResponse
}

export class TransformRegistry {
  private transforms: Map<string, Transform> = new Map()
  private responseTransforms: Map<string, ResponseTransform> = new Map()

  registerRequestTransform(name: string, transform: Transform): void {
    this.transforms.set(name, transform)
  }

  registerResponseTransform(name: string, transform: ResponseTransform): void {
    this.responseTransforms.set(name, transform)
  }

  getRequestTransform(name: string): Transform {
    const transform = this.transforms.get(name)
    if (!transform) {
      throw new Error(`Request transform not found: ${name}`)
    }
    return transform
  }

  getResponseTransform(name: string): ResponseTransform {
    const transform = this.responseTransforms.get(name)
    if (!transform) {
      throw new Error(`Response transform not found: ${name}`)
    }
    return transform
  }
}

export function createTransformRegistry(): TransformRegistry {
  return new TransformRegistry()
}
