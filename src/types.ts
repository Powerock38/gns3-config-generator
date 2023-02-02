export type InterfaceId = string
export type RouterId = string
export type Ip = string

export type PInterface = {
  id: InterfaceId
  neighbor: RouterId
  ip: Ip
}

export type PRouter = {
  id: RouterId
  managementHost: string
  interfaces: PInterface[]
  ipLo: Ip
}

export type CERouter = {
  id: RouterId
  managementHost: string
  interfaceId: InterfaceId
  interfaceIp: Ip
}

export type Client = {
  id: string
  as: number
  rtNo: number
  routers: CERouter[]
}
