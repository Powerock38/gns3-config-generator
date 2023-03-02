import { IpGen } from "./IpGen"
import { c, openTelnet } from "./telnet"
import {
  CERouter,
  Client,
  Config,
  PInterface,
  PRouter,
  RouterId,
} from "./types"

export async function configure(config: Config) {
  // Configure P routers
  for (const pRouter of config.pRouters) {
    await openTelnet(pRouter.telnetHost)

    await c(`hostname ${pRouter.id}`)
    await c(`ip cef`)
    await c(`router ospf 1`)

    // Loopback
    await c(`interface Loopback0`)
    await c(`ip address ${pRouter.ipLo.toStringWithMask()}`)
    await c(`ip ospf 1 area 0`)

    // if PE, connect BGP to other PEs
    if (pRouter.isPE) {
      await c(`router bgp ${config.asn}`)
      await c(`bgp log-neighbor-changes`)

      // bgp neighbors are all other PEs
      const peRouters = config.pRouters.filter(
        (otherRouter) => otherRouter.isPE && otherRouter.id !== pRouter.id
      )
      for (const peRouter of peRouters as PRouter[]) {
        await c(`neighbor ${peRouter.ipLo} remote-as ${config.asn}`)
        await c(`neighbor ${peRouter.ipLo} update-source Loopback0`)
        await c(`address-family vpnv4`)
        await c(`neighbor ${peRouter.ipLo} activate`)
        await c(`neighbor ${peRouter.ipLo} send-community both`)
        await c(`exit-address-family`)
      }
    }

    // interfaces
    for (const iface of pRouter.interfaces) {
      const client = config.clients.find((client) =>
        client.routers.find((ce) => ce.id === iface.neighbor)
      )
      const ceRouter = client?.routers.find((ce) => ce.id === iface.neighbor)

      // if PE
      if (client && ceRouter) {
        await configureCEonPEinterface(client, ceRouter, iface, config.asn)
      } else {
        // if regular P router
        await c(`interface ${iface.id}`)
        await c(`description INTERNAL link to ${iface.neighbor}`)
        await c(`ip ospf 1 area 0`)
        await c(`negotiation auto`)
        await c(`mpls ip`)
        await c(`ip address ${iface.ip.toStringWithMask()}`)
        await c(`no shutdown`)
      }
    }
  }

  // configure CE routers
  for (const client of config.clients) {
    for (const ceRouter of client.routers) {
      const pe = config.pRouters.find((p) =>
        p.interfaces.find((iface) => iface.neighbor === ceRouter.id)
      )
      if (!pe) {
        throw new Error(`Router connected to ${ceRouter.interfaceId} not found`)
      }

      const peIface = pe.interfaces.find(
        (iface) => iface.neighbor === ceRouter.id
      )
      if (!peIface) {
        throw new Error(`PE interface not found`)
      }

      await configureCE(ceRouter, pe.id, peIface.ip, config.asn)
    }
  }
}

export async function configureCEonPEinterface(
  client: Client,
  ceRouter: CERouter,
  peIface: PInterface,
  asn: number
) {
  // VRF
  await c(`vrf definition ${ceRouter.id}`)
  await c(`rd ${asn}:${ceRouter.rd}`)
  await c(`route-target export ${asn}:${client.rtGroup}`)
  await c(`route-target import ${asn}:${client.rtGroup}`)
  for (const rtGroup of client.friendsRtGroup) {
    await c(`route-target import ${asn}:${rtGroup}`)
  }
  await c(`address-family ipv4`)
  await c(`exit-address-family`)

  // interface
  await c(`interface ${peIface.id}`)
  await c(`description EXTERNAL link to ${peIface.neighbor}`)
  await c(`vrf forwarding ${peIface.neighbor}`)
  await c(`ip address ${peIface.ip.toStringWithMask()}`)
  await c(`no shutdown`)

  // BGP
  await c(`router bgp ${asn}`)
  await c(`address-family ipv4 vrf ${ceRouter.id}`)
  await c(`neighbor ${ceRouter.interfaceIp} remote-as ${ceRouter.asn}`)
  await c(`neighbor ${ceRouter.interfaceIp} activate`)
  await c(`exit-address-family`)
}

export async function configureCE(
  ceRouter: CERouter,
  peId: RouterId,
  peIfaceIP: IpGen,
  asn: number
) {
  await openTelnet(ceRouter.telnetHost)

  await c(`hostname ${ceRouter.id}`)
  await c(`ip cef`)

  await c(`interface ${ceRouter.interfaceId}`)
  await c(`description link to ${peId}`)
  await c(`ip address ${ceRouter.interfaceIp.toStringWithMask()}`)
  await c(`no shutdown`)

  await c(`router bgp ${ceRouter.asn}`)
  await c(`redistribute connected`)

  await c(`neighbor ${peIfaceIP} remote-as ${asn}`)
  await c(`neighbor ${peIfaceIP} allowas-in`)
}
