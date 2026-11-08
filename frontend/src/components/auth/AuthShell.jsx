/**
 * Нэвтрэх хуудсуудын нийтлэг хүрээ (Login, ChangePassword).
 *
 * Дэвсгэр нь зураг ашиглахгүй — бүгд CSS + inline SVG:
 *  1) #0B1220 хар хөхөөс гүн градиент
 *  2) изометрик (30°) шугамын хээ, захаараа бүдгэрнэ
 *  3) баруун доод буланд Ochir нэрийн бүдэг хээ
 * Тиймээс ямар ч гуравдагч брэндийн зураг, нэмэлт файл ачаалахгүй.
 */

// 30° изометрик тор: нэг хээ = 2 налуу шугам + 1 босоо шугам
const ISO_W = 56
const ISO_H = 32 // ≈ ISO_W · tan(30°)

function IsoPattern() {
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="auth-iso" width={ISO_W} height={ISO_H} patternUnits="userSpaceOnUse">
          <path
            d={`M0 0 L${ISO_W} ${ISO_H} M${ISO_W} 0 L0 ${ISO_H} M${ISO_W / 2} 0 V${ISO_H}`}
            fill="none"
            stroke="#7FA6FF"
            strokeOpacity="0.07"
            strokeWidth="1"
          />
        </pattern>
        <radialGradient id="auth-fade" cx="50%" cy="45%" r="70%">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="auth-mask">
          <rect width="100%" height="100%" fill="url(#auth-fade)" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="url(#auth-iso)" mask="url(#auth-mask)" />
    </svg>
  )
}

export default function AuthShell({ children }) {
  return (
    <main
      className="relative min-h-screen flex items-center justify-center px-6 py-10 text-ink overflow-hidden"
      style={{
        backgroundColor: '#0B1220',
        backgroundImage:
          'radial-gradient(ellipse 80% 60% at 50% 0%, #16264A 0%, transparent 70%),' +
          'radial-gradient(ellipse 60% 50% at 100% 100%, #0F1D3A 0%, transparent 70%),' +
          'linear-gradient(180deg, #0B1220 0%, #070C17 100%)',
      }}
    >
      <IsoPattern />

      {/* Ochir нэрийн бүдэг хээ — зөвхөн том дэлгэцэнд */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-6 -right-4 hidden select-none font-brand font-bold text-[180px] leading-none tracking-tight sm:block"
        style={{ color: '#7FA6FF', opacity: 0.05 }}
      >
        Ochir
      </span>

      <div className="relative w-full max-w-sm">{children}</div>
    </main>
  )
}
