/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import { installPixelLoaderStyles, pixelLoaderInner } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** Hold per tip; the same clock as the history curtain. */
const TIP_HOLD_MS = 3200

/**
 * DigitalOcean stack tips for the boot wait. The boot page runs before the
 * locale service exists, so this pre-locale surface carries its own English
 * copy (matching the client's default locale). Keep this deck aligned with the
 * conversation namespace's `session.surf.*` lines and the vscode `boot.tip.*`
 * lines; all three rotate the same thirty bare sentences.
 */
const BOOT_TIPS = [
  'App Platform can redeploy on every push to your branch.',
  'Droplets are just waves with an IP address.',
  'Spaces speaks S3, so existing SDKs just work.',
  'DOKS manages the control plane; you just ride the pods.',
  'Floating IPs move between Droplets; DNS stays put.',
  'A VPC is a reef wall for your Droplets.',
  'Volumes outlive the Droplet that mounts them.',
  'Load Balancers can terminate TLS at the edge.',
  'Functions: a wave that only exists when called.',
  'Managed databases take the daily backup off your plate.',
  'A Droplet\'s metadata service hands cloud-init its first instructions.',
  'The doctl CLI can list every Droplet in one command.',
  'Cloud Firewalls can follow tags, so new Droplets inherit the rules.',
  'Snapshots freeze a Droplet image before the next big change.',
  'Spaces lifecycle rules can retire old objects without a cron job.',
  'A Spaces CDN edge keeps static assets close to the reader.',
  'Container Registry keeps the image next to the cluster that pulls it.',
  'DOKS node pools let one cluster carry different Droplet sizes.',
  'GPU Droplets put the accelerator on the same private network.',
  'Managed database read-only replicas take the reporting load.',
  'Trusted sources keep a managed database off the public internet.',
  'Load Balancer health checks pull a bad Droplet out of rotation.',
  'A Floating IP can move to a replacement Droplet without a DNS edit.',
  'Volume snapshots let you roll back a disk without rebuilding the Droplet.',
  'Monitoring alert policies can warn you before the disk fills.',
  'Uptime checks watch a URL from several regions at once.',
  'Projects group Droplets, databases, and Spaces in one place.',
  'Tags are the handle Firewalls and scripts use to find a Droplet.',
  'Terraform\'s DigitalOcean provider turns the fleet into one plan.',
  'A Droplet\'s user-data script runs once, on first boot.',
] as const

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Create one decorative tip line for the surf swap. */
function tipLine(text: string, phase: 'in' | 'out'): HTMLSpanElement {
  const line = document.createElement('span')
  line.className = css.tipLine ?? ''
  line.dataset.surfLine = phase
  line.setAttribute('aria-hidden', 'true')
  line.textContent = text
  return line
}

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly titleRow: HTMLDivElement
  private readonly spinner: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly states = new Map<string, LoaderEntryState>()
  private failure: string | undefined
  private tipStep = 0
  private tipTimer: ReturnType<typeof setInterval> | undefined

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.dshBoot = ''
    this.card = div(css.card)
    this.titleRow = div(css.titleRow)
    this.titleRow.append(div(css.wordmark, 'DigitalOcean Harness'))
    this.spinner = div(css.spinner)
    this.spinner.dataset.dshBootSpinner = ''
    // The brand mark sweeps while the tips rotate below it; the page stays
    // flat like the history curtain, with no progress arc or glow.
    installPixelLoaderStyles()
    this.spinner.innerHTML = `<svg viewBox="0 0 16 16" width="128" height="128" fill="currentColor" aria-hidden="true">${pixelLoaderInner()}</svg>`
    this.hint = div(css.hint)
    this.hint.dataset.dshBootTips = ''
    this.hint.setAttribute('role', 'status')
    this.hint.setAttribute('aria-live', 'polite')
    this.hint.setAttribute('aria-label', 'Loading plugins…')
    this.card.append(this.spinner, this.titleRow, this.hint)
    this.root.append(this.card)
    container.append(this.root)
    this.startTips()
  }

  /**
   * Kernel-facing roster size; the sweep shows no progress arc.
   * @param _total - Complete boot roster size.
   */
  setTotal(_total: number): void {}

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.stopTips()
    this.root.remove()
  }

  /** Start the tip clock once; repeated calls are no-ops. */
  private startTips(): void {
    if (this.tipTimer !== undefined) return
    this.renderTips()
    this.tipTimer = setInterval(() => {
      this.tipStep += 1
      this.renderTips()
    }, TIP_HOLD_MS)
  }

  /** Stop the tip clock while the failure report owns the card. */
  private stopTips(): void {
    if (this.tipTimer === undefined) return
    clearInterval(this.tipTimer)
    this.tipTimer = undefined
  }

  /** Replace the hint with the departing line and the arriving one. */
  private renderTips(): void {
    const count = BOOT_TIPS.length
    const current = BOOT_TIPS[this.tipStep % count] ?? ''
    const previous = this.tipStep === 0 ? undefined : BOOT_TIPS[(this.tipStep - 1) % count] ?? ''
    const lines = previous === undefined ? [] : [tipLine(previous, 'out')]
    lines.push(tipLine(current, 'in'))
    this.hint.replaceChildren(...lines)
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      if (this.spinner.parentElement !== this.card) {
        this.card.replaceChildren(this.spinner, this.titleRow, this.hint)
        this.startTips()
      }
      return
    }
    this.stopTips()
    const report = div(css.failed)
    report.append(div(css.failedTitle, 'Failed to load plugins'))
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.titleRow, report)
  }
}
