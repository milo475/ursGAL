/**
 * fetch wrapper.
 * - accessToken зөвхөн санах ойд (module хувьсагч) — XSS-д localStorage-аас найдвартай
 * - refreshToken localStorage-д — refresh хийгдэхэд хуудас сэргээгдсэн ч session үлдэнэ
 * - 401 ирвэл нэг удаа refresh хийгээд хүсэлтийг давтана; бүтэхгүй бол
 *   'auth:logout' event гаргана (AuthContext сонсдог)
 * - Бүх алдаа { status, message } хэлбэртэй throw хийгдэнэ
 */

/**
 * API-ийн хаяг. Нэг серверээс үйлчилдэг үед харьцангуй '/api' хангалттай;
 * frontend-ийг тусад нь (жишээ нь Vercel) байршуулбал backend өөр домэйнд
 * байх тул VITE_API_BASE-ээр бүтэн хаягийг өгнө.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
const BASE = API_BASE
const REFRESH_KEY = 'refreshToken'

let accessToken = null

export function setTokens(data) {
  accessToken = data.accessToken ?? null
  /**
   * V5: refresh token localStorage-д ХАДГАЛАГДАХАА БОЛЬСОН.
   * Сервер түүнийг httpOnly cookie-гоор өгдөг болсон — JS огт хүрч
   * чадахгүй тул XSS амжилттай болсон ч 7 хоногийн session хулгайд
   * алдагдахгүй. Хуучин хадгалагдсан утгыг цэвэрлэнэ (шилжилт).
   */
  try {
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* үл тоомсорлоно */
  }
}

export function clearTokens() {
  accessToken = null
  try {
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* үл тоомсорлоно */
  }
}

function getRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_KEY)
  } catch {
    return null
  }
}

/** SSE (V4-09): EventSource header дэмждэггүй тул token-ыг query-гээр өгнө */
export function getAccessToken() {
  return accessToken
}

function normalizeError(status, payload) {
  let message = 'Алдаа гарлаа'
  if (payload && payload.message) {
    message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : payload.message
  }
  // Серверийн нэмэлт талбаруудыг үлдээнэ — 409 үед байгаа компанийг
  // санал болгох зэрэгт хэрэгтэй (status/message-ийг дарж бичихгүй)
  return { ...(payload ?? {}), status, message }
}

async function rawRequest(path, { method = 'GET', body } = {}) {
  const headers = {}
  // FormData бол Content-Type-ыг browser өөрөө (boundary-тэй) тавина
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) {
    headers['Content-Type'] = 'application/json'
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })

  let payload = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  return { res, payload }
}

/** Зэрэг олон 401 ирэхэд refresh нэг л удаа хийгдэнэ (single-flight) */
let refreshPromise = null

async function tryRefresh() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      // Cookie нь хүсэлттэй хамт өөрөө явна (same-origin). Хуучин
      // localStorage-д үлдсэн token байвал body-гоор нэг удаа өгнө —
      // амжилттай болмогц сервер cookie тавьж, бид устгана.
      const legacy = getRefreshToken()
      const { res, payload } = await rawRequest('/auth/refresh', {
        method: 'POST',
        body: legacy ? { refreshToken: legacy } : {},
      })
      if (!res.ok) return null
      setTokens(payload)
      return payload
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export async function api(path, options = {}) {
  const { res, payload } = await rawRequest(path, options)

  // Auth-ийн өөрийнх нь endpoint-ууд дээр retry хийхгүй
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      const second = await rawRequest(path, options)
      if (second.res.ok) return second.payload
      if (second.res.status !== 401) {
        throw normalizeError(second.res.status, second.payload)
      }
    }
    clearTokens()
    window.dispatchEvent(new CustomEvent('auth:logout'))
    throw normalizeError(401, payload)
  }

  if (!res.ok) {
    throw normalizeError(res.status, payload)
  }
  return payload
}

/** Хуудас нээгдэхэд refreshToken-оор session сэргээнэ (амжилтгүй бол null) */
export async function restoreSession() {
  return tryRefresh()
}

/**
 * Гарахад refresh token-ыг сервер талд revoke хийнэ (V4-08).
 * Алдаа гарсан ч гарах үйлдлийг саатуулахгүй.
 */
export async function serverLogout() {
  // V5: token нь httpOnly cookie-д тул body ихэвчлэн хоосон — сервер
  // cookie-гоо уншиж revoke хийгээд арилгана. Хуучин localStorage-ийн
  // үлдэц байвал хамт явуулна.
  const legacy = getRefreshToken()
  try {
    await rawRequest('/auth/logout', {
      method: 'POST',
      body: legacy ? { refreshToken: legacy } : {},
    })
  } catch {
    /* сүлжээгүй үед ч local гарах үргэлжилнэ */
  }
}

/**
 * Файл (CSV г.м.) татах — auth header-тэй fetch, 401-д нэг удаа refresh.
 * {blob, filename} буцаана.
 */
export async function apiBlob(path) {
  const doFetch = () =>
    fetch(BASE + path, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    })
  let res = await doFetch()
  if (res.status === 401) {
    const refreshed = await tryRefresh()
    if (refreshed) res = await doFetch()
  }
  if (!res.ok) {
    throw new Error(`Татаж чадсангүй (${res.status})`)
  }
  const dispo = res.headers.get('content-disposition') ?? ''
  const m = dispo.match(/filename="?([^";]+)"?/)
  return { blob: await res.blob(), filename: m?.[1] ?? 'report.csv' }
}

/**
 * Multipart илгээх туслах (жишээ: хүргэлтийн баталгаажуулах зураг).
 * fields доторх File/Blob утгууд файлаар, бусад нь string талбараар явна.
 * 401 retry зэрэг бүх логик api()-тай адил.
 */
export function apiUpload(path, fields, { method = 'POST' } = {}) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    form.append(key, value)
  }
  return api(path, { method, body: form })
}
