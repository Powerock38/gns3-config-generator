import { IpGen } from "./IpGen"
import { c, openTelnet } from "./telnet"
import { CERouter, Config, PRouter, RouterId } from "./types"

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

    // if PE, myClients contains all clients connected to this PE,
    // with 'routers' field containing only the CE routers connected to this PE
    const myClients = []
    for (const client of config.clients) {
      const ceRoutersNeighbors = []
      for (const ceRouter of client.routers) {
        for (const iface of pRouter.interfaces) {
          if (iface.neighbor === ceRouter.id) {
            ceRoutersNeighbors.push(ceRouter)
          }
        }
      }
      if (ceRoutersNeighbors.length) {
        myClients.push({ ...client, routers: ceRoutersNeighbors })
      }
    }

    for (const myClient of myClients) {
      for (const ceRouter of myClient.routers) {
        await c(`vrf definition ${ceRouter.id}`)
        await c(`rd ${config.asn}:${ceRouter.rd}`)
        await c(`route-target export ${config.asn}:${myClient.rtGroup}`)
        await c(`route-target import ${config.asn}:${myClient.rtGroup}`)
        for (const rtGroup of myClient.friendsRtGroup) {
          await c(`route-target import ${config.asn}:${rtGroup}`)
        }
        await c(`address-family ipv4`)
        await c(`exit-address-family`)
      }
    }

    // regular interfaces
    for (const iface of pRouter.interfaces) {
      await c(`interface ${iface.id}`)
      await c(`description link to ${iface.neighbor}`)

      // if PE
      const isConnectedToCE = !!config.clients.find((client) =>
        client.routers.find((ce) => ce.id === iface.neighbor)
      )
      if (isConnectedToCE) {
        await c(`vrf forwarding ${iface.neighbor}`)
      } else {
        // if regular P router
        await c(`ip ospf 1 area 0`)
        await c(`negotiation auto`)
        await c(`mpls ip`)
      }

      await c(`ip address ${iface.ip.toStringWithMask()}`)
      await c(`no shutdown`)
    }

    // if PE
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

      for (const myClient of myClients) {
        for (const ceRouter of myClient.routers) {
          await c(`address-family ipv4 vrf ${ceRouter.id}`)
          await c(`neighbor ${ceRouter.interfaceIp} remote-as ${ceRouter.asn}`)
          await c(`neighbor ${ceRouter.interfaceIp} activate`)
          await c(`exit-address-family`)
        }
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
