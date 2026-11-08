import { registerSW } from 'virtual:pwa-register'

/**
 * PWA бүртгэл + автомат шинэчлэл.
 *
 * SW нь skipWaiting + clientsClaim-тай тул шинэ хувилбар суумагц шууд
 * идэвхжинэ. registerType 'autoUpdate' үед registerSW шинэ SW удирдлага
 * авахад хуудсыг өөрөө reload хийнэ — хуучин JS/кэш дээр үлдэхгүй.
 *
 * Жолооч app-аа өдөржин нээлттэй байлгадаг тул шинэ хувилбарыг цаг тутам,
 * мөн таб дахин харагдах үед шалгана.
 */
const CHECK_EVERY_MS = 60 * 60 * 1000

export function setupPWA() {
  if (!('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })
}
