/**
 * Auth middleware tests
 */

import { describe, it, expect, vi } from "vitest"
import type { Request, Response, NextFunction } from "express"
import { createAuthMiddleware, extractApiKey } from "./auth.js"
import type { AuthConfig } from "../../config/schema.js"

describe("extractApiKey", () => {
  it("extracts key from Authorization Bearer header", () => {
    const req = {
      headers: {
        authorization: "Bearer test-key-123",
      },
    } as Request

    expect(extractApiKey(req)).toBe("test-key-123")
  })

  it("extracts key from x-api-key header", () => {
    const req = {
      headers: {
        "x-api-key": "test-key-456",
      },
    } as Request

    expect(extractApiKey(req)).toBe("test-key-456")
  })

  it("prefers Authorization header over x-api-key", () => {
    const req = {
      headers: {
        authorization: "Bearer auth-key",
        "x-api-key": "header-key",
      },
    } as Request

    expect(extractApiKey(req)).toBe("auth-key")
  })

  it("returns null when no key is present", () => {
    const req = {
      headers: {},
    } as Request

    expect(extractApiKey(req)).toBeNull()
  })
})

describe("createAuthMiddleware", () => {
  it("passes through when auth is disabled", () => {
    const config: AuthConfig = {
      enabled: false,
      apiKey: "test-key",
    }

    const middleware = createAuthMiddleware({ config })
    const req = {} as Request
    const res = {} as Response
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledWith()
  })

  it("passes through when no API key is configured", () => {
    const config: AuthConfig = {
      enabled: true,
      apiKey: undefined,
    }

    const middleware = createAuthMiddleware({ config })
    const req = {} as Request
    const res = {} as Response
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it("rejects request with missing API key", () => {
    const config: AuthConfig = {
      enabled: true,
      apiKey: "secret-key",
    }

    const middleware = createAuthMiddleware({ config })
    const req = {
      headers: {},
    } as Request

    const json = vi.fn()
    const status = vi.fn(() => ({ json }))
    const res = { status } as unknown as Response
    const next = vi.fn()

    middleware(req, res, next)

    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({
      error: {
        type: "authentication_error",
        message: "Missing API key",
      },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it("rejects request with invalid API key", () => {
    const config: AuthConfig = {
      enabled: true,
      apiKey: "secret-key",
    }

    const middleware = createAuthMiddleware({ config })
    const req = {
      headers: {
        authorization: "Bearer wrong-key",
      },
    } as Request

    const json = vi.fn()
    const status = vi.fn(() => ({ json }))
    const res = { status } as unknown as Response
    const next = vi.fn()

    middleware(req, res, next)

    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({
      error: {
        type: "authentication_error",
        message: "Invalid API key",
      },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it("passes through with valid API key and attaches tenant context", () => {
    const config: AuthConfig = {
      enabled: true,
      apiKey: "secret-key",
    }

    const middleware = createAuthMiddleware({ config })
    const req = {
      headers: {
        authorization: "Bearer secret-key",
      },
    } as Request & { tenantId?: string }

    const res = {} as Response
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledWith()
    expect(req.tenantId).toBe("default")
  })

  it("accepts API key from x-api-key header", () => {
    const config: AuthConfig = {
      enabled: true,
      apiKey: "secret-key",
    }

    const middleware = createAuthMiddleware({ config })
    const req = {
      headers: {
        "x-api-key": "secret-key",
      },
    } as Request

    const res = {} as Response
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledWith()
  })
})
