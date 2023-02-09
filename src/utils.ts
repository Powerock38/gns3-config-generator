import { Telnet } from "telnet-client"
import CONFIG from "./config.json"

let currentRd = 0
export function rdGenerator() {
  const c = currentRd
  currentRd++
  if (currentRd === 65535) {
    throw new Error("RD exhausted")
  }
  return c
}

let currentTelnet: Telnet | undefined
export async function openTelnet(host: string) {
  const [ip, port] = host.split(":")

  currentTelnet = new Telnet()
  await currentTelnet.connect({
    host: ip,
    port: parseInt(port),
    shellPrompt: "/ # ",
    timeout: 1500,
  })

  console.log("CONNECTED TO " + host)

  await c(`en`)
  await c(`conf t`)
}

export async function c(cmd: string) {
  console.log(cmd)
  if (!currentTelnet) {
    throw new Error("Telnet not connected")
  }

  const res = await currentTelnet.exec(cmd)
  console.log("res>", res)
}

export function getClientFromRouter(routerId: string) {
  return CONFIG.clients.find((c) => c.routers.find((r) => r.id === routerId))
}

export class IpGen {
  static fromCidr(cidr: string) {
    const [ipStr, maskSizeStr] = cidr.split("/")

    const maskSize = parseInt(maskSizeStr)
    const mask = 0xffffffff << (32 - maskSize)

    const [a, b, c, d] = ipStr.split(".").map((i) => parseInt(i))
    const ip = (a << 24) | (b << 16) | (c << 8) | d

    return new IpGen(ip, mask)
  }

  private static binToString(bin: number) {
    return (
      (bin >>> 24) +
      "." +
      ((bin >>> 16) & 0xff) +
      "." +
      ((bin >>> 8) & 0xff) +
      "." +
      (bin & 0xff)
    )
  }

  private constructor(private ip: number, private mask: number) {}

  toStringWithMask() {
    return `${this} ${IpGen.binToString(this.mask)}`
  }

  toString() {
    return IpGen.binToString(this.ip)
  }

  getNext() {
    const newIp = this.ip + 1
    if ((newIp & this.mask) !== (this.ip & this.mask)) {
      throw new Error(`IP range exhausted: ${this}`)
    }
    return new IpGen(newIp, this.mask)
  }

  incrementSelf(incr: number) {
    const newIp = this.ip + incr
    if ((newIp & this.mask) !== (this.ip & this.mask)) {
      throw new Error(`IP range exhausted: ${this}`)
    }
    this.ip = newIp
  }
}
