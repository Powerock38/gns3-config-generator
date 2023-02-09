import CONFIG from "./config.json"
import { CERouter, Client, PInterface, PRouter } from "./types"
import { c, getClientFromRouter, IpGen, openTelnet, rdGenerator } from "./utils"

const loIP = IpGen.fromCidr(CONFIG.loCidr)
const pIP = IpGen.fromCidr(CONFIG.pCidr)

const CLIENTS: Client[] = []
const PROUTERS: PRouter[] = []

// PARSE CONFIG

for (const pRouter of CONFIG.provider_routers) {
  const interfaces: PInterface[] = []

  for (const iface of pRouter.interfaces) {
    let neighborIface: PInterface | undefined
    for (const pRouterNeighbor of PROUTERS) {
      if (iface.neighbor === pRouterNeighbor.id) {
        for (const ifaceNeighbor of pRouterNeighbor.interfaces) {
          if (ifaceNeighbor.neighbor === pRouter.id) {
            neighborIface = ifaceNeighbor
            break
          }
        }
      }
    }

    let ip: IpGen
    if (neighborIface) {
      ip = neighborIface.ip.getNext()
    } else {
      ip = pIP.getNext()
      pIP.incrementSelf(4)
    }

    interfaces.push({
      id: iface.id,
      neighbor: iface.neighbor,
      ip,
    })
  }

  PROUTERS.push({
    id: pRouter.id,
    managementHost: pRouter.managementHost,
    interfaces,
    ipLo: loIP.getNext(),
  })

  loIP.incrementSelf(1)
}

for (const client of CONFIG.clients) {
  const routers: CERouter[] = []

  for (const ceRouter of client.routers) {
    let neighborIface: PInterface | undefined
    for (const pRouterNeighbor of PROUTERS) {
      for (const ifaceNeighbor of pRouterNeighbor.interfaces) {
        if (ifaceNeighbor.neighbor === ceRouter.id) {
          neighborIface = ifaceNeighbor
          break
        }
      }
    }

    if (!neighborIface) {
      throw new Error("No PE found for CE " + ceRouter.id)
    }

    routers.push({
      id: ceRouter.id,
      managementHost: ceRouter.managementHost,
      interfaceId: ceRouter.interfaceId,
      interfaceIp: neighborIface.ip.getNext(),
    })
  }

  CLIENTS.push({
    id: client.id,
    as: client.as,
    rtNo: client.rtNo,
    routers,
  })
}

// WRITE GNS3 CONFIG

for (const pRouter of PROUTERS) {
  openTelnet(pRouter.managementHost)

  c(`hostname ${pRouter.id}`)
  c(`ip cef`)
  c(`router ospf 1`)

  // Loopback
  c(`interface Loopback0`)
  c(`ip address ${pRouter.ipLo} 255.255.255.255`)
  c(`ip ospf 1 area 0`)

  // other interfaces
  for (const iface of pRouter.interfaces) {
    c(`interface ${iface.id}`)
    c(`description link to ${iface.neighbor}`)

    // if PE
    const client = getClientFromRouter(iface.neighbor)
    if (client) {
      c(`vrf forwarding ${client.id}`)
    }

    c(`ip address ${iface.ip} 255.255.255.252`)

    // if regular P router
    if (!client) {
      c(`ip ospf 1 area 0`)

      c(`negotiation auto`)

      c(`mpls ip`)

      c(`no shutdown`)
    }
  }

  // if PE

  // myClients contains all clients connected to this PE,
  // with 'routers' field containing only the CE routers connected to this PE
  const myClients = CLIENTS.flatMap((client) => {
    const ceRoutersNeighbors = client.routers.filter((ceRouter) =>
      pRouter.interfaces.find((iface) => {
        iface.id === ceRouter.interfaceId
      })
    )
    if (!ceRoutersNeighbors) return []
    else return [{ ...client, routers: ceRoutersNeighbors }]
  })

  if (myClients) {
    for (const client of myClients) {
      c(`vrf definition ${client.id}`)
      c(`rd ${CONFIG.as}:${rdGenerator()}`) // new RD for each VRF
      c(`route-target export ${CONFIG.as}:${client.rtNo}`)
      c(`route-target import ${CONFIG.as}:${client.rtNo}`)
      c(`address-family ipv4`)
      c(`exit-address-family`)
    }

    c(`router bgp ${CONFIG.as}`)
    c(`bgp log-neighbor-changes`)

    // neighbors are all other PEs
    const peRouters = PROUTERS.filter((router) => {
      return router.id !== pRouter.id && !!getClientFromRouter(router.id)
    })
    for (const peRouter of peRouters as PRouter[]) {
      c(`neighbor ${peRouter.ipLo} remote-as ${CONFIG.as}`)
      c(`neighbor ${peRouter.ipLo} update-source Loopback0`)
      c(`address-family vpnv4`)
      c(`neighbor ${peRouter.ipLo} activate`)
      c(`neighbor ${peRouter.ipLo} send-community both`)
      c(`exit-address-family`)
    }

    for (const myClient of myClients) {
      c(`address-family ipv4 vrf ${myClient.id}`)

      for (const ceRouter of myClient.routers) {
        c(`neighbor ${ceRouter.interfaceIp} remote-as ${myClient.as}`)
        c(`neighbor ${ceRouter.interfaceIp} activate`)
      }

      c(`exit-address-family`)
    }
  }
}

for (const client of CLIENTS) {
  for (const ceRouter of client.routers) {
    openTelnet(ceRouter.managementHost)

    c(`hostname ${ceRouter.id}`)
    c(`ip cef`)

    c(`interface ${ceRouter.interfaceId}`)

    c(`router bgp ${client.as}`)
    c(`redistribute connected`)

    const pe = PROUTERS.find((p) =>
      p.interfaces.find((iface) => iface.neighbor === ceRouter.id)
    )
    if (!pe) {
      throw new Error(`Router connected to ${ceRouter.interfaceId} not found`)
    }

    c(`description link to ${pe.id}`)

    const peIface = pe.interfaces.find(
      (iface) => iface.neighbor === ceRouter.id
    )
    if (!peIface) throw new Error(`Interface not found`)

    c(`neighbor ${peIface.ip} remote-as ${CONFIG.as}`)
  }
}
