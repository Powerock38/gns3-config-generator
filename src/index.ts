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

async function configure() {
  for (const pRouter of PROUTERS) {
    await openTelnet(pRouter.managementHost)

    await c(`write erase`)

    await c(`hostname ${pRouter.id}`)
    await c(`ip cef`)
    await c(`router ospf 1`)

    // Loopback
    await c(`interface Loopback0`)
    await c(`ip address ${pRouter.ipLo} 255.255.255.255`)
    await c(`ip ospf 1 area 0`)

    // other interfaces
    for (const iface of pRouter.interfaces) {
      await c(`interface ${iface.id}`)
      await c(`description link to ${iface.neighbor}`)

      // if PE
      const client = getClientFromRouter(iface.neighbor)
      if (client) {
        await c(`vrf forwarding ${client.id}`)
      }

      await c(`ip address ${iface.ip} 255.255.255.252`)

      // if regular P router
      if (!client) {
        await c(`ip ospf 1 area 0`)

        await c(`negotiation auto`)

        await c(`mpls ip`)

        await c(`no shutdown`)
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
        await c(`vrf definition ${client.id}`)
        await c(`rd ${CONFIG.as}:${rdGenerator()}`) // new RD for each VRF
        await c(`route-target export ${CONFIG.as}:${client.rtNo}`)
        await c(`route-target import ${CONFIG.as}:${client.rtNo}`)
        await c(`address-family ipv4`)
        await c(`exit-address-family`)
      }

      await c(`router bgp ${CONFIG.as}`)
      await c(`bgp log-neighbor-changes`)

      // neighbors are all other PEs
      const peRouters = PROUTERS.filter((router) => {
        return router.id !== pRouter.id && !!getClientFromRouter(router.id)
      })
      for (const peRouter of peRouters as PRouter[]) {
        await c(`neighbor ${peRouter.ipLo} remote-as ${CONFIG.as}`)
        await c(`neighbor ${peRouter.ipLo} update-source Loopback0`)
        await c(`address-family vpnv4`)
        await c(`neighbor ${peRouter.ipLo} activate`)
        await c(`neighbor ${peRouter.ipLo} send-community both`)
        await c(`exit-address-family`)
      }

      for (const myClient of myClients) {
        await c(`address-family ipv4 vrf ${myClient.id}`)

        for (const ceRouter of myClient.routers) {
          await c(`neighbor ${ceRouter.interfaceIp} remote-as ${myClient.as}`)
          await c(`neighbor ${ceRouter.interfaceIp} activate`)
        }

        await c(`exit-address-family`)
      }
    }
  }

  for (const client of CLIENTS) {
    for (const ceRouter of client.routers) {
      openTelnet(ceRouter.managementHost)

      await c(`hostname ${ceRouter.id}`)
      await c(`ip cef`)

      await c(`interface ${ceRouter.interfaceId}`)

      await c(`router bgp ${client.as}`)
      await c(`redistribute connected`)

      const pe = PROUTERS.find((p) =>
        p.interfaces.find((iface) => iface.neighbor === ceRouter.id)
      )
      if (!pe) {
        throw new Error(`Router connected to ${ceRouter.interfaceId} not found`)
      }

      await c(`description link to ${pe.id}`)

      const peIface = pe.interfaces.find(
        (iface) => iface.neighbor === ceRouter.id
      )
      if (!peIface) throw new Error(`Interface not found`)

      await c(`neighbor ${peIface.ip} remote-as ${CONFIG.as}`)
    }
  }
}

configure().then(() => {
  console.log("Done")
})
