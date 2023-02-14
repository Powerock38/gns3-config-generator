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
  managementHost: string
  interfaces: PInterface[]
  ipLo: IpGen
  isPE: boolean
}

export type CERouter = {
  id: RouterId
  managementHost: string
  interfaceId: InterfaceId
  interfaceIp: IpGen
  as: number
}

export type Client = {
  id: string
  rtNo: number
  routers: CERouter[]
}
