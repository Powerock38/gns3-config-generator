import { IpGen } from "./IpGen"

export type InterfaceId = string
export type RouterId = string

export type PInterface = {
  id: InterfaceId
  neighbor: RouterId
  ip: IpGen
}

export type PRouter = {
  id: RouterId
  telnetHost: string
  interfaces: PInterface[]
  ipLo: IpGen
  isPE: boolean
}

export type CERouter = {
  id: RouterId
  telnetHost: string
  interfaceId: InterfaceId
  interfaceIp: IpGen
  ASN: number
}

export type Client = {
  id: string
  rtNo: number
  routers: CERouter[]
}
