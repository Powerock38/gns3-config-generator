import { IpGen } from "./IpGen"

export type InterfaceId = string
export type RouterId = string
export type ClientId = string

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
  asn: number
  rd: number
}

export type Client = {
  id: ClientId
  rtGroup: number
  friendsRtGroup: number[]
  routers: CERouter[]
}

export type Config = {
  asn: number
  pIPPool: IpGen
  loIPPool: IpGen
  pRouters: PRouter[]
  clients: Client[]
}

// JSON types

export type ConfigJson = {
  asn: number
  pCIDR: string
  loCIDR: string
  pRouters: PRouterJson[]
  clients: ClientJson[]
}

export type PInterfaceJson = {
  id: InterfaceId
  neighbor: RouterId
}

export type PRouterJson = {
  id: RouterId
  telnetHost: string
  interfaces: PInterfaceJson[]
}

export type CERouterJson = {
  id: RouterId
  asn: number
  pCIDR: string
  loCIDR: string
  telnetHost: string
  interfaceId: InterfaceId
}

export type ClientJson = {
  id: ClientId
  friends: ClientId[]
  routers: CERouterJson[]
}
