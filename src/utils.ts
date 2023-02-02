import CONFIG from "./config.json"

export class IpMaskGenerator {
  private startIp: number[]
  private currentIp: number[]
  private endIp: number[]
  private maskSize: number
  private mask: number[]

  constructor(cidr: string) {
    const [ip, maskSizeStr] = cidr.split("/")
    this.maskSize = parseInt(maskSizeStr)
    this.startIp = ip.split(".").map((i) => parseInt(i))
    this.currentIp = [...this.startIp]

    this.mask = []
    const maskBin = "1".repeat(this.maskSize) + "0".repeat(32 - this.maskSize)
    for (let i = 0; i < 4; i++) {
      this.mask.push(parseInt(maskBin.slice(i * 8, i * 8 + 8), 2))
    }

    this.endIp = this.mask.map((m, i) => {
      return this.startIp[i] | (255 ^ m)
    })
  }

  nextIp() {
    const s = this.currentIp.join(".")

    if (this.currentIp[3] === this.endIp[3]) {
      this.currentIp[3] = 0
      if (this.currentIp[2] === this.endIp[2]) {
        this.currentIp[2] = 0
        if (this.currentIp[1] === this.endIp[1]) {
          this.currentIp[1] = 0
          if (this.currentIp[0] === this.endIp[0]) {
            throw new Error("IP range exhausted")
          } else {
            this.currentIp[0]++
          }
        } else {
          this.currentIp[1]++
        }
      } else {
        this.currentIp[2]++
      }
    } else {
      this.currentIp[3]++
    }
    return s
  }

  nextIpMask() {
    return `${this.nextIp()} ${this.mask.join(".")}`
  }
}

let currentRd = 0
export function rdGenerator() {
  const c = currentRd
  currentRd++
  if (currentRd === 65535) {
    throw new Error("RD exhausted")
  }
  return c
}

export function openTelnet(host: string) {
  // TODO
  console.log(`telnet ${host}`)

  c(`en`)
  c(`conf t`)
}

export function c(cmd: string) {
  console.log(cmd)
}

export function getClientFromRouter(routerId: string) {
  return CONFIG.clients.find((c) => c.routers.find((r) => r.id === routerId))
}

export function binIpToString(ip: number) {
  return (
    (ip >>> 24) +
    "." +
    ((ip >>> 16) & 0xff) +
    "." +
    ((ip >>> 8) & 0xff) +
    "." +
    (ip & 0xff)
  )
}

export function stringIpToBin(ip: string) {
  const [a, b, c, d] = ip.split(".").map((i) => parseInt(i))
  return (a << 24) | (b << 16) | (c << 8) | d
}
