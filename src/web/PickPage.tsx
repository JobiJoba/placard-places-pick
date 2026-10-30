import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router"

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

type Place = {
  id: string
  name: string
  category: string
  address: string | null
  location: { lat: number; lng: number }
  googlePlaceId: string | null
  coverThumbUrl?: string | null
}

const radiusOptions = [1, 2, 5, 10, 25] as const
const SPIN_MS = 1400
const SPIN_NAMES = ["Da Michele", "L'Asador", "Café Sperl", "Ramen Spot", "The Corner"] as const
const API = "/api/m/places.pick"

type PoolSource = "all" | "list" | "tag"
type ListRow = { id: string; name: string }
type TagRow = { name: string }

const categoryLabel = (c: PlaceCategory) => c.replaceAll("_", " ")

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  })
  const text = await response.text()
  const body = text === "" ? undefined : JSON.parse(text)
  if (!response.ok) {
    throw new Error(body?.message ?? `Request failed (${response.status})`)
  }
  return body as T
}

function mapsGoogle(place: Place) {
  const q = place.googlePlaceId
    ? `api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.googlePlaceId)}`
    : `api=1&query=${place.location.lat},${place.location.lng}`
  return `https://www.google.com/maps/search/?${q}`
}

export function PickPage() {
  const [lists, setLists] = useState<ListRow[] | null>(null)
  const [tags, setTags] = useState<TagRow[] | null>(null)
  const [category, setCategory] = useState<PlaceCategory | "">("")
  const [poolSource, setPoolSource] = useState<PoolSource>("all")
  const [listId, setListId] = useState("")
  const [tagName, setTagName] = useState("")
  const [openTonight, setOpenTonight] = useState(true)
  const [nearMe, setNearMe] = useState(false)
  const [radiusKm, setRadiusKm] = useState(5)
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [avoidRecent, setAvoidRecent] = useState(true)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [spinLabel, setSpinLabel] = useState("")
  const [result, setResult] = useState<Place | null>(null)
  const [spinError, setSpinError] = useState<string | null>(null)

  useEffect(() => {
    void apiJson<ListRow[]>("/api/lists")
      .then(setLists)
      .catch(() => setLists([]))
    void apiJson<TagRow[]>("/api/tags")
      .then(setTags)
      .catch(() => setTags([]))
  }, [])

  useEffect(() => {
    if (!nearMe) {
      setNear(null)
      setGeoError(null)
      return
    }
    let cancelled = false
    setGeoLoading(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return
        setGeoLoading(false)
        setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        if (cancelled) return
        setGeoLoading(false)
        setNear(null)
        setGeoError(err.message || "Could not get your location.")
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    )
    return () => {
      cancelled = true
    }
  }, [nearMe])

  const request = useMemo(() => {
    if (poolSource === "list" && !listId) return null
    if (poolSource === "tag" && !tagName) return null
    if (nearMe && !near) return null
    return {
      avoidRecent,
      ...(category ? { category } : {}),
      open: openTonight ? ("tonight" as const) : undefined,
      list: poolSource === "list" ? listId : undefined,
      tag: poolSource === "tag" ? tagName : undefined,
      ...(nearMe && near ? { near, radiusKm } : {}),
    }
  }, [avoidRecent, category, listId, near, nearMe, openTonight, poolSource, radiusKm, tagName])

  useEffect(() => {
    if (!request) {
      setPreviewCount(null)
      setPreviewError(null)
      return
    }
    let cancelled = false
    setPreviewError(null)
    void apiJson<{ count: number }>(`${API}/preview`, {
      method: "POST",
      body: JSON.stringify(request),
    }).then(
      (preview) => {
        if (!cancelled) setPreviewCount(preview.count)
      },
      (cause: unknown) => {
        if (!cancelled) {
          setPreviewCount(null)
          setPreviewError(cause instanceof Error ? cause.message : "Preview failed")
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [request])

  const choose = useCallback(() => {
    if (!request || spinning) return
    setSpinError(null)
    setResult(null)
    setSpinning(true)
    let tick = 0
    const timer = window.setInterval(() => {
      setSpinLabel(SPIN_NAMES[tick % SPIN_NAMES.length] ?? "")
      tick += 1
    }, 90)
    const started = Date.now()
    void apiJson<{ place: Place }>(`${API}/spin`, {
      method: "POST",
      body: JSON.stringify(request),
    })
      .then(async (outcome) => {
        const wait = Math.max(0, SPIN_MS - (Date.now() - started))
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        window.clearInterval(timer)
        setSpinLabel(outcome.place.name)
        setResult(outcome.place)
        setPreviewCount((n) => (n == null ? n : Math.max(0, n - (avoidRecent ? 1 : 0))))
        setSpinning(false)
      })
      .catch((cause: unknown) => {
        window.clearInterval(timer)
        setSpinning(false)
        setSpinLabel("")
        setSpinError(cause instanceof Error ? cause.message : "Spin failed")
      })
  }, [avoidRecent, request, spinning])

  const poolLabel = category ? `All ${categoryLabel(category)}s` : "All places"

  return (
    <div
      style={{ maxWidth: 512, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}
    >
      <header style={{ textAlign: "center" }}>
        <p
          style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.6 }}
        >
          Library
        </p>
        <h1
          style={{
            fontSize: 36,
            margin: "8px 0",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Pick
        </h1>
        <p style={{ fontSize: 14, opacity: 0.7 }}>
          One place from your library — any type, open tonight, near you, or surprise me.
        </p>
      </header>

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 20,
          border: "1px solid var(--crate-edge, #3a322c)",
          borderRadius: 8,
          background: "var(--crate, #2a2420)",
          color: "var(--parchment, #f3ebe1)",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
          Type
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PlaceCategory | "")}
            style={selectStyle}
          >
            <option value="">Any type</option>
            {placeCategories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
          Pool
          <select
            value={poolSource}
            onChange={(e) => setPoolSource(e.target.value as PoolSource)}
            style={selectStyle}
          >
            <option value="all">{poolLabel}</option>
            <option value="list">A list</option>
            <option value="tag">A tag</option>
          </select>
        </label>

        {poolSource === "list" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
            List
            <select value={listId} onChange={(e) => setListId(e.target.value)} style={selectStyle}>
              <option value="">{lists ? "Choose a list" : "Loading…"}</option>
              {(lists ?? []).map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {poolSource === "tag" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
            Tag
            <select
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              style={selectStyle}
            >
              <option value="">{tags ? "Choose a tag" : "Loading…"}</option>
              {(tags ?? []).map((tag) => (
                <option key={tag.name} value={tag.name}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={openTonight}
            onChange={(e) => setOpenTonight(e.target.checked)}
          />
          Open tonight
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <input type="checkbox" checked={nearMe} onChange={(e) => setNearMe(e.target.checked)} />
          Near me
        </label>

        {nearMe && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
            Radius
            <select
              value={String(radiusKm)}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              style={selectStyle}
            >
              {radiusOptions.map((km) => (
                <option key={km} value={km}>
                  {km} km
                </option>
              ))}
            </select>
            {geoLoading && (
              <span style={{ fontSize: 12, opacity: 0.7 }}>Getting your location…</span>
            )}
            {geoError && <span style={{ fontSize: 12, color: "#f87171" }}>{geoError}</span>}
          </label>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={avoidRecent}
            onChange={(e) => setAvoidRecent(e.target.checked)}
          />
          Avoid recent picks (14 days)
        </label>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            borderTop: "1px solid var(--crate-edge, #3a322c)",
            paddingTop: 16,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, opacity: 0.75 }}>
            {previewError
              ? "Couldn't count the pool"
              : previewCount == null
                ? nearMe && !near
                  ? "Waiting for location…"
                  : "…"
                : previewCount === 0
                  ? "Nothing in the pool"
                  : `${previewCount} in the pool`}
          </p>
          <button
            type="button"
            disabled={!request || spinning || previewCount === 0}
            onClick={choose}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "var(--action, #e8a54b)",
              color: "var(--action-fg, #1a1612)",
              fontWeight: 600,
              cursor: !request || spinning || previewCount === 0 ? "not-allowed" : "pointer",
              opacity: !request || spinning || previewCount === 0 ? 0.5 : 1,
            }}
          >
            {spinning ? "Choosing…" : "Choose for me"}
          </button>
        </div>
      </section>

      {(previewError || spinError) && (
        <p style={{ color: "#b91c1c", fontSize: 14 }}>{previewError ?? spinError}</p>
      )}

      <div
        style={{
          minHeight: 192,
          borderRadius: 8,
          border: "1px solid var(--crate-edge, #3a322c)",
          background: "var(--crate-raised, #342c26)",
          color: "var(--parchment, #f3ebe1)",
          overflow: "hidden",
        }}
        aria-live="polite"
      >
        {spinning ? (
          <div style={{ height: 192, display: "grid", placeItems: "center", textAlign: "center" }}>
            <div>
              <p style={{ fontSize: 28, margin: 0, textTransform: "uppercase" }}>
                {spinLabel || "…"}
              </p>
              <p
                style={{
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  opacity: 0.7,
                }}
              >
                Spinning
              </p>
            </div>
          </div>
        ) : result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
            <div>
              <p
                style={{
                  fontSize: 11,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  opacity: 0.7,
                }}
              >
                Tonight
              </p>
              <h2 style={{ margin: "4px 0", fontSize: 24, textTransform: "uppercase" }}>
                {result.name}
              </h2>
              {result.address && (
                <p style={{ margin: 0, fontSize: 14, opacity: 0.75 }}>{result.address}</p>
              )}
              <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.6 }}>{result.category}</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Link to={`/places/${result.id}`} style={linkBtn}>
                Open place
              </Link>
              <a href={mapsGoogle(result)} target="_blank" rel="noreferrer" style={linkBtnOutline}>
                Maps
              </a>
              <button
                type="button"
                disabled={!request || (previewCount ?? 1) <= 0}
                onClick={choose}
                style={linkBtnOutline}
              >
                Spin again
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              height: 192,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              padding: 24,
            }}
          >
            <div>
              <p style={{ fontSize: 20, textTransform: "uppercase", margin: 0 }}>
                Ready when you are
              </p>
              <p style={{ fontSize: 14, opacity: 0.7 }}>
                Pick a type, set the pool, then hit choose.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const selectStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--crate-edge, #3a322c)",
  background: "var(--crate-raised, #342c26)",
  color: "inherit",
}

const linkBtn: CSSProperties = {
  display: "inline-block",
  padding: "6px 12px",
  borderRadius: 6,
  background: "var(--action, #e8a54b)",
  color: "var(--action-fg, #1a1612)",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 600,
}

const linkBtnOutline: CSSProperties = {
  display: "inline-block",
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid var(--crate-edge, #3a322c)",
  background: "transparent",
  color: "inherit",
  textDecoration: "none",
  fontSize: 13,
  cursor: "pointer",
}
