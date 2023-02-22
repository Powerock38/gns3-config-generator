import { exit } from "process"
import CONFIG from "./config.json"
import { IpGen } from "./IpGen"
import { c, openTelnet } from "./telnet"
import { CERouter, Client, PInterface, PRouter } from "./types"
import { getClientFromCEid, rdGenerator } from "./utils"

const DRY_RUN = false

const loIP = IpGen.fromCIDR(CONFIG.loCIDR)
const pIP = IpGen.fromCIDR(CONFIG.pCIDR)

const CLIENTS: Client[] = []
const PROUTERS: PRouter[] = []

function parseConfig() {
  console.log("PARSING CONFIG")

  for (const pRouter of CONFIG.providerRouters) {
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
      telnetHost: pRouter.telnetHost,
      interfaces,
      ipLo: loIP.getNext(),
      isPE: false, // correctly set in next loop
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
            pRouterNeighbor.isPE = true
            break
          }
        }
      }

      if (!neighborIface) {
        throw new Error("No PE found for CE " + ceRouter.id)
      }

      routers.push({
        id: ceRouter.id,
        ASN: ceRouter.ASN,
        telnetHost: ceRouter.telnetHost,
        interfaceId: ceRouter.interfaceId,
        interfaceIp: neighborIface.ip.getNext(),
      })
    }

    CLIENTS.push({
      id: client.id,
      rtNo: client.rtNo,
      routers,
    })
  }
}

function printConfig() {
  for (const pRouter of PROUTERS) {
    console.log({
      ...pRouter,
      ipLo: pRouter.ipLo.toString(),
      interfaces: pRouter.interfaces.map((iface) => ({
        ...iface,
        ip: iface.ip.toString(),
      })),
    })
  }
  for (const client of CLIENTS) {
    console.log({
      ...client,
      routers: client.routers.map((router) => ({
        ...router,
        interfaceIp: router.interfaceIp.toString(),
      })),
    })
  }
}

async function configure() {
  console.log("CONFIGURING ROUTERS")

  for (const pRouter of PROUTERS) {
    await openTelnet(pRouter.telnetHost)

    await c(`hostname ${pRouter.id}`)
    await c(`ip cef`)
    await c(`router ospf 1`)

    // Loopback
    await c(`interface Loopback0`)
    await c(`ip address ${pRouter.ipLo} 255.255.255.255`)
    await c(`ip ospf 1 area 0`)

    // if PE, myClients contains all clients connected to this PE,
    // with 'routers' field containing only the CE routers connected to this PE
    const myClients = []
    for (const client of CLIENTS) {
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
        await c(`vrf definition ${myClient.id}-${ceRouter.id}`)
        await c(`rd ${CONFIG.ASN}:${rdGenerator()}`) // new RD for each VRF
        await c(`route-target export ${CONFIG.ASN}:${myClient.rtNo}`)
        await c(`route-target import ${CONFIG.ASN}:${myClient.rtNo}`)
        await c(`address-family ipv4`)
        await c(`exit-address-family`)
      }
    }

    // regular interfaces
    for (const iface of pRouter.interfaces) {
      await c(`interface ${iface.id}`)
      await c(`description link to ${iface.neighbor}`)

      // if PE
      const myClient = getClientFromCEid(iface.neighbor)
      if (myClient) {
        await c(`vrf forwarding ${myClient.id}-${iface.neighbor}`)
      } else {
        // if regular P router
        await c(`ip ospf 1 area 0`)
        await c(`negotiation auto`)
        await c(`mpls ip`)
      }

      await c(`ip address ${iface.ip} 255.255.255.252`)
      await c(`no shutdown`)
    }

    // if PE
    if (myClients) {
      await c(`router bgp ${CONFIG.ASN}`)
      await c(`bgp log-neighbor-changes`)

      // bgp neighbors are all other PEs
      const peRouters = PROUTERS.filter(
        (otherRouter) => otherRouter.isPE && otherRouter.id !== pRouter.id
      )
      for (const peRouter of peRouters as PRouter[]) {
        await c(`neighbor ${peRouter.ipLo} remote-as ${CONFIG.ASN}`)
        await c(`neighbor ${peRouter.ipLo} update-source Loopback0`)
        await c(`address-family vpnv4`)
        await c(`neighbor ${peRouter.ipLo} activate`)
        await c(`neighbor ${peRouter.ipLo} send-community both`)
        await c(`exit-address-family`)
      }

      for (const myClient of myClients) {
        for (const ceRouter of myClient.routers) {
          await c(`address-family ipv4 vrf ${myClient.id}-${ceRouter.id}`)
          await c(`neighbor ${ceRouter.interfaceIp} remote-as ${ceRouter.ASN}`)
          await c(`neighbor ${ceRouter.interfaceIp} activate`)
          await c(`exit-address-family`)
        }
      }
    }
  }

  for (const client of CLIENTS) {
    for (const ceRouter of client.routers) {
      await openTelnet(ceRouter.telnetHost)

      await c(`hostname ${ceRouter.id}`)
      await c(`ip cef`)

      const pe = PROUTERS.find((p) =>
        p.interfaces.find((iface) => iface.neighbor === ceRouter.id)
      )
      if (!pe) {
        throw new Error(`Router connected to ${ceRouter.interfaceId} not found`)
      }

      await c(`interface ${ceRouter.interfaceId}`)
      await c(`description link to ${pe.id}`)
      await c(`ip address ${ceRouter.interfaceIp} 255.255.255.252`)
      await c(`no shutdown`)

      await c(`router bgp ${ceRouter.ASN}`)
      await c(`redistribute connected`)

      const peIface = pe.interfaces.find(
        (iface) => iface.neighbor === ceRouter.id
      )
      if (!peIface) throw new Error(`Interface not found`)

      await c(`neighbor ${peIface.ip} remote-as ${CONFIG.ASN}`)
      await c(`neighbor ${peIface.ip} allowas-in`)
    }
  }
}

parseConfig()
printConfig()
if (!DRY_RUN) {
  configure().then(() => {
    console.log("\nDONE")
    exit()
  })
}
