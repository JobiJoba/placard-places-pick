import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { CreateModuleResult, ModuleMcpContext, ModuleMcpResult } from "../placard-sdk.ts"

const placeCategories = [
  "restaurant",
  "cafe",
  "bar",
  "park",
  "museum",
  "cinema",
  "hotel",
  "trail",
  "other",
] as const

type PlaceCategory = (typeof placeCategories)[number]

const AVOID_MS = 14 * 24 * 60 * 60 * 1000

type PickRow = { ownerId: string; placeId: string; pickedAt: string }

type SearchHit = { place: { id: string; name: string; category: string; [key: string]: unknown } }

type PickRequest = {
  avoidRecent?: boolean
  category?: PlaceCategory
  open?: "now" | "tonight"
  text?: string
  near?: { lat: number; lng: number }
  radiusKm?: number
  tag?: string
  list?: string
  status?: string
}

type PluginCtx = {
  readonly moduleId: string
  readonly pathSuffix: string
  readonly rootDir?: string
  readonly ownerId?: string
  readonly hostFetch?: (path: string, init?: RequestInit) => Promise<Response>
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } })

const resolveRootDir = (ctx: PluginCtx) => {
  if (typeof ctx.rootDir === "string" && ctx.rootDir.length > 0) return ctx.rootDir
  const base = process.env.PLACARD_MODULES_DIR?.trim() || "./data/modules"
  return join(base, ctx.moduleId)
}

const resolveOwnerId = (ctx: PluginCtx) =>
  typeof ctx.ownerId === "string" && ctx.ownerId.length > 0 ? ctx.ownerId : "unknown"

const defaultHostFetch = async (request: Request, path: string, init?: RequestInit) => {
  const url = new URL(path, request.url)
  const headers = new Headers(init?.headers)
  const cookie = request.headers.get("cookie")
  if (cookie) headers.set("cookie", cookie)
  const authorization = request.headers.get("authorization")
  if (authorization) headers.set("authorization", authorization)
  const origin = request.headers.get("origin") ?? url.origin
  headers.set("origin", origin)
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  return fetch(url, { ...init, headers })
}

const hostFetchFor = (request: Request | null, ctx: PluginCtx) => {
  if (ctx.hostFetch) return ctx.hostFetch
  if (request) {
    return (path: string, init?: RequestInit) => defaultHostFetch(request, path, init)
  }
  return async () => {
    throw new Error("hostFetch is required when no inbound Request is available")
  }
}

const readPicks = async (rootDir: string): Promise<PickRow[]> => {
  try {
    const raw = await readFile(join(rootDir, "data", "picks.json"), "utf8")
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as PickRow[]) : []
  } catch {
    return []
  }
}

const writePicks = async (rootDir: string, rows: ReadonlyArray<PickRow>) => {
  const dir = join(rootDir, "data")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "picks.json"), JSON.stringify(rows, null, 2))
}

const recentIds = (rows: ReadonlyArray<PickRow>, ownerId: string, now: number) => {
  const cutoff = now - AVOID_MS
  return new Set(
    rows
      .filter((row) => row.ownerId === ownerId && Date.parse(row.pickedAt) >= cutoff)
      .map((row) => row.placeId),
  )
}

const emptyMessage = (request: PickRequest) => {
  if (request.open === "tonight") {
    return "Nothing open tonight matches these filters. Try turning off open tonight, widening the radius, or disabling avoid recent."
  }
  if (request.open === "now") {
    return "Nothing open now matches these filters. Try turning off open now, widening the radius, or disabling avoid recent."
  }
  if (request.category) {
    return `No ${request.category} places match these filters. Try a different list, tag, or radius — or turn off avoid recent.`
  }
  return "No places match these filters. Try a different list, tag, or radius — or turn off avoid recent."
}

const parsePickRequest = (body: Record<string, unknown>): PickRequest => {
  const category = body.category
  if (category != null && category !== "" && !placeCategories.includes(category as PlaceCategory)) {
    throw new Error("Invalid category")
  }
  const filter: PickRequest = {
    avoidRecent: body.avoidRecent === true,
  }
  if (typeof category === "string" && category !== "") filter.category = category as PlaceCategory
  if (body.open === "now" || body.open === "tonight") filter.open = body.open
  if (typeof body.text === "string") filter.text = body.text
  if (body.near && typeof body.near === "object") {
    const near = body.near as { lat?: unknown; lng?: unknown }
    if (typeof near.lat === "number" && typeof near.lng === "number") {
      filter.near = { lat: near.lat, lng: near.lng }
    }
  }
  if (typeof body.radiusKm === "number") filter.radiusKm = body.radiusKm
  if (typeof body.tag === "string") filter.tag = body.tag
  if (typeof body.list === "string") filter.list = body.list
  if (typeof body.status === "string") filter.status = body.status
  return filter
}

const parseBody = async (request: Request): Promise<PickRequest> => {
  const body = (await request.json()) as Record<string, unknown>
  return parsePickRequest(body)
}

const toSearchPayload = (pickRequest: PickRequest) => {
  const { avoidRecent: _, ...filter } = pickRequest
  return filter
}

const queryPool = async (
  fetchHost: (path: string, init?: RequestInit) => Promise<Response>,
  rootDir: string,
  ownerId: string,
  pickRequest: PickRequest,
) => {
  const searchRes = await fetchHost("/api/search", {
    method: "POST",
    body: JSON.stringify(toSearchPayload(pickRequest)),
  })
  if (!searchRes.ok) {
    throw new Error(`Search failed (${searchRes.status})`)
  }
  let hits = (await searchRes.json()) as SearchHit[]
  if (pickRequest.avoidRecent) {
    const rows = await readPicks(rootDir)
    const recent = recentIds(rows, ownerId, Date.now())
    hits = hits.filter((hit) => !recent.has(hit.place.id))
  }
  return hits
}

const spinOnce = async (
  fetchHost: (path: string, init?: RequestInit) => Promise<Response>,
  rootDir: string,
  ownerId: string,
  pickRequest: PickRequest,
): Promise<{ ok: true; place: SearchHit["place"] } | { ok: false; message: string }> => {
  const hits = await queryPool(fetchHost, rootDir, ownerId, pickRequest)
  if (hits.length === 0) {
    return { ok: false, message: emptyMessage(pickRequest) }
  }
  const index = Math.floor(Math.random() * hits.length)
  const hit = hits[index]
  if (!hit) {
    return { ok: false, message: emptyMessage(pickRequest) }
  }
  const rows = await readPicks(rootDir)
  rows.push({
    ownerId,
    placeId: hit.place.id,
    pickedAt: new Date().toISOString(),
  })
  await writePicks(rootDir, rows)
  return { ok: true, place: hit.place }
}

const pickPlaceInputSchema = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: [...placeCategories],
      description: "Optional place category. Omit for any type.",
    },
    text: { type: "string" },
    open: { type: "string", enum: ["now", "tonight"] },
    near: {
      type: "object",
      properties: { lat: { type: "number" }, lng: { type: "number" } },
    },
    radiusKm: { type: "number" },
    tag: { type: "string" },
    list: { type: "string" },
    status: { type: "string", enum: ["want_to_go", "been_there"] },
    avoidRecent: { type: "boolean" },
  },
}

export const pickPlaceToolDef = {
  name: "pick_place",
  title: "Pick a place",
  description:
    "Pick one place from your library (any category, open now/tonight, list/tag/radius, optional avoid-recent). Same rules as the Pick wheel.",
  inputSchema: pickPlaceInputSchema,
}

const handlePickPlace = async (
  args: Record<string, unknown>,
  ctx: ModuleMcpContext,
): Promise<ModuleMcpResult> => {
  try {
    const pickRequest = parsePickRequest(args)
    const result = await spinOnce(ctx.hostFetch, ctx.rootDir, ctx.ownerId, pickRequest)
    if (!result.ok) {
      return { ok: false, error: result.message }
    }
    return {
      ok: true,
      data: {
        id: result.place.id,
        name: result.place.name,
        address: result.place.address ?? null,
        category: result.place.category,
      },
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Pick failed" }
  }
}

export function createModule(): CreateModuleResult {
  return {
    createHttpApp: async (request: Request, ctx: PluginCtx): Promise<Response> => {
      const path = ctx.pathSuffix.replace(/^\/+/, "")
      const rootDir = resolveRootDir(ctx)
      const ownerId = resolveOwnerId(ctx)
      const fetchHost = hostFetchFor(request, ctx)
      try {
        if (request.method === "GET" && (path === "" || path === "meta")) {
          return json({
            id: "places.pick",
            categories: [...placeCategories],
          })
        }

        if (request.method === "POST" && path === "preview") {
          const pickRequest = await parseBody(request)
          const hits = await queryPool(fetchHost, rootDir, ownerId, pickRequest)
          return json({ count: hits.length })
        }

        if (request.method === "POST" && path === "spin") {
          const pickRequest = await parseBody(request)
          const result = await spinOnce(fetchHost, rootDir, ownerId, pickRequest)
          if (!result.ok) {
            return json({ _tag: "PickPoolEmpty", message: result.message }, 404)
          }
          return json({ place: result.place })
        }

        return json({ message: "Not found" }, 404)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Pick failed"
        return json({ message }, 400)
      }
    },
    mcpTools: [
      {
        def: pickPlaceToolDef,
        handler: handlePickPlace,
      },
    ],
  }
}
