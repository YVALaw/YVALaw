import type { YvaApi } from '../shared/types'

declare global {
  interface Window { yva: YvaApi }
}
