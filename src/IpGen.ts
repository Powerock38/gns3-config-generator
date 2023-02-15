export class IpGen {
  static fromCIDR(cidr: string) {
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

  // toStringWithMask() {
  //   return `${this} ${IpGen.binToString(this.mask)}`
  // }

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
