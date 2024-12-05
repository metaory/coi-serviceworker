/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
const NAME = 'COOP/COEP Service Worker'
let coepCredentialless = false // TODO: <<

const coi = new Proxy(
  {
    shouldDeregister: false,
    coepCredentialless: true,
    coepDegrade: true,
    doReload: this?.window?.location?.reload,
    quiet: false,
  },
  {
    get: (t, p) => this?.window?.coi?.[p] ?? t[p] ?? null,
    set: () => true,
  },
)

const log = new Proxy(
  {},
  {
    get:
      (_, lvl) =>
      (msg, ...ctx) =>
       this?.window?.coi?.quiet || console[lvl in console ? lvl : 'debug'](NAME, msg, ...ctx),
  },
)

const registerWorker = () =>
  navigator.serviceWorker.register(window.document.currentScript.src).then(
    registration => {
      log.info('Registered', registration.scope)

      registration.addEventListener('updatefound', () => {
        log.info('Updated', 'Reloading page')
        window.sessionStorage.setItem('coiReloadedBySelf', 'updatefound')
        coi.doReload()
      })

      // If the registration is active, but it's not controlling the page
      if (registration.active && !navigator.serviceWorker.controller) {
        log.info('Active with no controller', 'Reloading page')
        window.sessionStorage.setItem('coiReloadedBySelf', 'notcontrolling')
        coi.doReload()
      }
    },
    err => {
      log.error('failed to register:', err)
    },
  )

if (!this.window) {
  self.addEventListener('install', self.skipWaiting)
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
  self.addEventListener('message', ({ data }) => {
    if (!data) {
      return
    }

    const { type, value } = data

    log.debug('Processing message', type, value)

    switch (type) {
      case 'deregister':
        self.registration
          .unregister()
          .then(self.clients.matchAll)
          .then(clients => {
            for (const client of clients) {
              client.navigate(client.url)
            }
          })
        break

      case 'coepCredentialless':
        coepCredentialless = value
        break

      default:
        log.debug('Ignoring unhandled message', type, value)
    }
  })

  self.addEventListener('fetch', event => {
    const r = event.request
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') {
      return
    }

    const opt = { credentials: 'omit' }
    const request = coepCredentialless && r.mode === 'no-cors' ? new Request(r, opt) : r
    event.respondWith(
      fetch(request)
        .then(response => {
          const { status, statusText, headers, body } = response
          if (status === 0) {
            return response
          }

          const newHeaders = new Headers(headers)
          newHeaders.set(
            'Cross-Origin-Embedder-Policy',
            coepCredentialless ? 'credentialless' : 'require-corp',
          )
          if (!coepCredentialless) {
            newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin')
          }
          newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin')

          return new Response(body, {
            status,
            statusText,
            headers: newHeaders,
          })
        })
        .catch(log.error),
    )
  })
}

// TODO: fix: Excessive complexity of 18 detected (max: 15).
//  [lint/complexity/noExcessiveCognitiveComplexity
queueMicrotask(() => {
  if (!this.window) {
    return log.warn('No window')
  }

  const reloadedBySelf = window.sessionStorage.getItem('coiReloadedBySelf')
  const coepDegrading = reloadedBySelf === 'coepdegrade'
  const { constroller: controlling } = navigator.serviceWorker

  window.sessionStorage.removeItem('coiReloadedBySelf')

  if (controlling) {
    // Record the failure if the page is served by serviceWorker.
    if (!window.crossOriginIsolated) {
      window.sessionStorage.setItem('coiCoepHasFailed', 'true')
    }
    const coepHasFailed = window.sessionStorage.getItem('coiCoepHasFailed')
    // Reload only on the first failure.
    const reloadToDegrade = coi.coepDegrade && !(coepDegrading || window.crossOriginIsolated)

    navigator.serviceWorker.controller.postMessage({
      type: 'coepCredentialless',
      value: reloadToDegrade || (coepHasFailed && coi.coepDegrade) ? false : coi.coepCredentialless,
    })
    if (reloadToDegrade) {
      log.info('Reloading page to degrade COEP.')
      window.sessionStorage.setItem('coiReloadedBySelf', 'coepdegrade')
      coi.doReload('coepdegrade')
    }

    if (coi.shouldDeregister) {
      navigator.serviceWorker.controller.postMessage({ type: 'deregister' })
    }
  }

  // Perhaps COOP/COEP are already set from the origin server
  // or the browser has no notion of crossOriginIsolated
  if (window.crossOriginIsolated) {
    return log.debug('Not registered', 'secure context is required')
  }

  if (!window.isSecureContext) {
    return log.warn('Not registered', 'secure context is required')
  }

  if (reloadedBySelf) {
    return log.info('Already coi', 'do nothing')
  }

  // In some environments (e.g. Firefox private mode) this won't be available
  if (!navigator.serviceWorker) {
    return log.error('Not registered', 'perhaps due to private mode')
  }

  registerWorker()
})
