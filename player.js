/**
 * Reproductor Android - HTML/CSS/JS puro
 * - Canal por ?id=<canal>
 * - Solo selector de servidores (bottom sheet)
 * - Botón pantalla completa con intento de bloqueo horizontal
 * - JWPlayer para HLS/DASH + ClearKey, con fallback a <video> + Hls.js y último recurso <iframe>
 * - Nunca cambia de canal por gestos; swipe vertical abre/cierra la hoja
 */

;(() => {
  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

  const app = $("#app")
  const playerEl = $("#player")
  const titleEl = $("#title")
  const sheet = $("#sheet")
  const sheetBackdrop = $("#sheet-backdrop")
  const serversGrid = $("#servers-grid")
  const btnServers = $("#btn-servers")
  const btnCloseSheet = $("#btn-close-sheet")
  const btnFullscreen = $("#btn-fullscreen")
  const emptyState = $("#empty-state")

  let channelKey = ""
  let servers = []
  let activeServerIndex = 0

  const state = {
    mode: null, // "jw" | "video" | "iframe"
    hls: null, // instancia Hls.js
    touchStart: null,
  }

  function getParam(name) {
    const url = new URL(window.location.href)
    return url.searchParams.get(name)
  }

  function setSheetOpen(open) {
    if (open) {
      sheet.classList.add("open")
      sheetBackdrop.hidden = false
      btnServers.setAttribute("aria-expanded", "true")
    } else {
      sheet.classList.remove("open")
      sheetBackdrop.hidden = true
      btnServers.setAttribute("aria-expanded", "false")
    }
  }

  function clearPlayer() {
    try {
      if (window.jwplayer && state.mode === "jw") {
        const api = window.jwplayer("player")
        api && api.remove && api.remove()
      }
    } catch (e) {}
    try {
      if (state.hls) {
        state.hls.destroy?.()
        state.hls = null
      }
    } catch (e) {}
    if (playerEl) playerEl.innerHTML = ""
    state.mode = null
  }

  function fallbackToIframe(url) {
    clearPlayer()
    const iframe = document.createElement("iframe")
    iframe.src = url
    iframe.width = "100%"
    iframe.height = "100%"
    iframe.allowFullscreen = true
    iframe.allow = "autoplay; fullscreen; picture-in-picture clipboard-write; encrypted-media"
    iframe.frameBorder = "0"
    iframe.scrolling = "auto"
    iframe.loading = "lazy"
    playerEl.appendChild(iframe)
    state.mode = "iframe"
  }

  async function fallbackToNativeHls(url) {
    clearPlayer()
    const video = document.createElement("video")
    video.setAttribute("playsinline", "true")
    video.muted = true // autoplay móvil
    video.autoplay = true
    video.controls = false
    video.preload = "auto"
    video.crossOrigin = "anonymous"
    video.style.width = "100%"
    video.style.height = "100%"
    video.style.objectFit = "contain"
    playerEl.appendChild(video)
    state.mode = "video"

    const canNative = video.canPlayType("application/vnd.apple.mpegurl")
    if (canNative) {
      video.src = url
      try {
        await video.play()
      } catch (e) {}
      return
    }

    try {
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true })
        state.hls = hls
        hls.loadSource(url)
        hls.attachMedia(video)
        video.addEventListener("canplay", () => {
          video.play().catch(() => {})
        })
        hls.on(window.Hls.Events.ERROR, (_e, data) => {
          if (data?.fatal) video.controls = true // último recurso
        })
        return
      }
    } catch (e) {}
    video.controls = true // último recurso
  }

  function buildJwSources(srv) {
    const url = srv?.url || ""
    const k1 = srv?.k1
    const k2 = srv?.k2
    if (!url) return null

    if (url.includes(".m3u8")) return [{ file: url }]

    if (url.includes(".mpd")) {
      if (k1 && k2) {
        return [{ file: url, drm: { clearkey: { keyId: k1, key: k2 } } }]
      }
      return [{ file: url }]
    }

    return null // no media directa
  }

  function setupPlayer() {
    if (!playerEl || !servers?.length) return
    const srv = servers[Math.max(0, Math.min(activeServerIndex, servers.length - 1))]
    const sources = buildJwSources(srv)

    // No es media directa -> iframe
    if (!sources) {
      fallbackToIframe(srv.url)
      return
    }

    // JWPlayer (HTML5)
    if (window.jwplayer) {
      const api = window.jwplayer("player").setup({
        playlist: [{ title: channelKey, description: "live", sources }],
        width: "100%",
        height: "100%",
        autostart: true,
        mute: true,
        playsinline: true,
        primary: "html5",
        androidhls: true,
        displaytitle: false,
        stretching: "uniform",
        preload: "auto",
        liveSyncDuration: 3,
      })

      api.once("error", (err) => {
        console.warn("JW error:", err)
        const file = sources?.[0]?.file || ""
        // Error 102630 y similares -> fallback a HLS nativo si es .m3u8
        if (file.includes(".m3u8")) {
          fallbackToNativeHls(file)
        } else {
          // DASH u otros -> intenta iframe
          fallbackToIframe(srv.url)
        }
      })

      // Preferir pista de audio 1 si existe (opcional)
      try {
        api.on("play", () => {
          try {
            api.setCurrentAudioTrack(1)
          } catch (e) {}
        })
      } catch (e) {}

      state.mode = "jw"
      return
    }

    // Sin jwplayer cargado: fallback directo
    if (sources[0]?.file?.includes(".m3u8")) {
      fallbackToNativeHls(sources[0].file)
    } else {
      fallbackToIframe(srv.url)
    }
  }

  function renderServers() {
    serversGrid.innerHTML = ""
    servers.forEach((srv, idx) => {
      const btn = document.createElement("button")
      btn.className = "server-btn" + (idx === activeServerIndex ? " active" : "")
      btn.type = "button"
      btn.role = "listitem"
      btn.textContent = srv.nombre || `Servidor ${idx + 1}`
      btn.addEventListener("click", () => {
        if (idx !== activeServerIndex) {
          activeServerIndex = idx
          $$(".server-btn", serversGrid).forEach((b, i) => b.classList.toggle("active", i === activeServerIndex))
          setupPlayer()
        } else {
          // mismo servidor: recarga
          setupPlayer()
        }
        setSheetOpen(false)
      })
      serversGrid.appendChild(btn)
    })
  }

  function normalizeServers(cfgItem) {
    if (!cfgItem) return []
    if (Array.isArray(cfgItem.servidores) && cfgItem.servidores.length) return cfgItem.servidores
    if (cfgItem.url) return [{ url: cfgItem.url, nombre: "Servidor 1", k1: cfgItem.k1, k2: cfgItem.k2 }]
    return []
  }

  function initFromConfig() {
    const cfg = window.ConfiguracionCanales || {}
    const paramId = getParam("id") || ""
    const keys = Object.keys(cfg)
    if (!keys.length) {
      emptyState.hidden = false
      return
    }

    channelKey = keys.includes(paramId) ? paramId : keys[0]
    const sParam = getParam("s")
    const cfgItem = cfg[channelKey]

    titleEl.textContent = `Canal: ${channelKey}`
    servers = normalizeServers(cfgItem)
    if (!servers.length) {
      emptyState.hidden = false
      return
    }

    // servidor inicial por ?s= (1-indexed o 0-indexed)
    let sIdx = Number.parseInt(sParam ?? "", 10)
    if (!isFinite(sIdx)) sIdx = 0
    if (sIdx > 0) sIdx = sIdx - 1
    activeServerIndex = Math.max(0, Math.min(servers.length - 1, sIdx))

    renderServers()
    setupPlayer()
  }

  // Eventos UI
  btnServers.addEventListener("click", () => setSheetOpen(true))
  btnCloseSheet.addEventListener("click", () => setSheetOpen(false))
  sheetBackdrop.addEventListener("click", () => setSheetOpen(false))

  // Pantalla completa + lock landscape
  btnFullscreen.addEventListener("click", async () => {
    const el = app
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen()
        try {
          await screen.orientation?.lock?.("landscape")
        } catch (e) {}
      } else {
        await document.exitFullscreen()
      }
    } catch (e) {}
  })

  // Gestos: solo vertical para abrir/cerrar hoja. Nunca cambiar canal.
  app.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches[0]
      state.touchStart = { x: t.screenX, y: t.screenY }
    },
    { passive: true },
  )
  app.addEventListener(
    "touchend",
    (e) => {
      if (!state.touchStart) return
      const t = e.changedTouches[0]
      const dx = t.screenX - state.touchStart.x
      const dy = t.screenY - state.touchStart.y
      const ax = Math.abs(dx),
        ay = Math.abs(dy)
      state.touchStart = null
      if (ax < 30 && ay < 30) return
      if (ay > ax) {
        if (dy < 0)
          setSheetOpen(true) // swipe up
        else setSheetOpen(false) // swipe down
      }
    },
    { passive: true },
  )

  // Sin canales en la URL -> mostrar guía
  window.addEventListener("DOMContentLoaded", () => {
    // Espera mínima a que cargue la config remota si llegó después del DOM
    const start = performance.now()
    const tryInit = () => {
      if (window.ConfiguracionCanales) {
        initFromConfig()
      } else if (performance.now() - start < 3000) {
        // reintenta por hasta 3s
        setTimeout(tryInit, 150)
      } else {
        emptyState.hidden = false
      }
    }
    tryInit()
  })
})()
