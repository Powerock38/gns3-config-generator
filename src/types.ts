import { IpGen } from "./utils"

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
}

export type CERouter = {
  id: RouterId
  managementHost: string
  interfaceId: InterfaceId
  interfaceIp: IpGen
}

export type Client = {
  id: string
  as: number
  rtNo: number
  routers: CERouter[]
}
