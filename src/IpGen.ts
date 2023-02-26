export class IpGen {
  static fromCIDR(cidr: string) {
    const [ipStr, maskSizeStr] = cidr.split("/")

    const maskSize = parseInt(maskSizeStr)
    const mask = IpGen.maskFromSize(maskSize)

    const [a, b, c, d] = ipStr.split(".").map((i) => parseInt(i))
    const ip = (a << 24) | (b << 16) | (c << 8) | d

    return new IpGen(ip, mask)
  }

  static fromRawObject(obj: { ip: number; mask: number }) {
    return new IpGen(obj.ip, obj.mask)
  }

  static deserializeInObject(o: Record<string, any>) {
    for (const [k, v] of Object.entries(o)) {
      if (v.hasOwnProperty("ip") && v.hasOwnProperty("mask")) {
        o[k] = IpGen.fromRawObject(v)
      } else if (v instanceof Object) {
        IpGen.deserializeInObject(v)
      }
    }
  }

  private static maskFromSize(size: number) {
    return 0xffffffff << (32 - size)
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

  getNext(newMaskSize: number) {
    const newIp = this.ip + 1
    if ((newIp & this.mask) !== (this.ip & this.mask)) {
      throw new Error(`IP range exhausted: ${this}`)
    }
    return new IpGen(newIp, IpGen.maskFromSize(newMaskSize))
  }

  incrementSelf(incr: number) {
    const newIp = this.ip + incr
    if ((newIp & this.mask) !== (this.ip & this.mask)) {
      throw new Error(`IP range exhausted: ${this}`)
    }
    this.ip = newIp
  }
}
